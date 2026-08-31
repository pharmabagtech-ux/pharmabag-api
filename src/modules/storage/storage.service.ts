import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

/**
 * Slug-sanitises a catalogue image base name: lowercase, alphanumerics and
 * single hyphens only. Shared by upload and rename so a hand-typed name and
 * an auto-derived one land in the same shape.
 */
export function sanitizeImageBaseName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, '') // tolerate a pasted extension
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor(private readonly config: ConfigService) {
    this.region = this.config.get<string>('AWS_REGION', 'ap-south-1');
    this.bucket = this.config.get<string>('AWS_BUCKET', 'pharmabag03');

    this.s3 = new S3Client({
      region: this.region,
    });
  }

  private readonly ALLOWED_IMAGE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/jpg',
    // The catalogue's existing 109 product images are AVIF; uploads that
    // replace them must be accepted in the same format.
    'image/avif',
  ];

  private readonly ALLOWED_DOC_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

  async uploadProductImage(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_IMAGE_TYPES);
    const key = await this.upload(file, 'product-images');
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  /**
   * Catalogue (master product) image with an SEO-meaningful file name.
   *
   * Unlike the uuid-named uploads above, the key here IS the SEO surface:
   * `images/<base-name>.<ext>`, where the caller derives base-name from the
   * product name (the storefront's convention appends "-pharmabag"). Goes to
   * the same `images/` folder as the existing catalogue set.
   */
  async uploadCatalogueImage(
    file: Express.Multer.File,
    baseName: string,
  ): Promise<string> {
    this.validateFile(file, this.ALLOWED_IMAGE_TYPES);
    const safe = sanitizeImageBaseName(baseName);
    if (!safe) throw new BadRequestException('Invalid image file name');
    const ext = (file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const key = `images/${safe}.${ext.replace(/[^a-z0-9]/g, '') || 'jpg'}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );
    this.logger.log(`Catalogue image uploaded: ${key}`);
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  /**
   * Rename a catalogue image by server-side S3 copy.
   *
   * The OLD object is deliberately left in place: its URL may still be cached
   * in rendered pages, sitemaps and Google's image index for hours, and a
   * dangling 404 there costs more than a few duplicated kilobytes.
   */
  async renameCatalogueImage(
    currentUrl: string,
    newBaseName: string,
  ): Promise<string> {
    const marker = '.amazonaws.com/';
    const idx = currentUrl.indexOf(marker);
    if (idx === -1) throw new BadRequestException('Not a catalogue image URL');
    const oldKey = currentUrl.slice(idx + marker.length);
    const safe = sanitizeImageBaseName(newBaseName);
    if (!safe) throw new BadRequestException('Invalid image file name');
    const ext = (oldKey.split('.').pop() || 'avif').toLowerCase();
    const newKey = `images/${safe}.${ext}`;
    if (newKey === oldKey) return currentUrl;
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${encodeURIComponent(oldKey).replace(/%2F/g, '/')}`,
        Key: newKey,
      }),
    );
    this.logger.log(`Catalogue image renamed (copied): ${oldKey} -> ${newKey}`);
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${newKey}`;
  }

  async uploadDrugLicense(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_DOC_TYPES);
    // For sensitive docs, return the Key, which will be used with /storage/view to get a presigned URL
    return this.upload(file, 'drug-licenses');
  }

  async uploadPaymentProof(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_DOC_TYPES);
    // For sensitive docs, return the Key
    return this.upload(file, 'payment-proofs');
  }

  async uploadKycDocument(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_DOC_TYPES);
    // For KYC, return the Key, not the public URL
    return this.upload(file, 'kyc-documents');
  }

  /**
   * Generate a temporary (presigned) URL for a private file
   * @param key S3 key (e.g. kyc-documents/uuid.pdf)
   * @param expiresIn Seconds until the link expires (default 1 hour)
   */
  async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    // Robust key extraction: If the 'key' is accidentally a full S3 URL, extract the actual key part
    let actualKey = key;
    if (key.startsWith('http')) {
      const parts = key.split('.amazonaws.com/');
      if (parts.length > 1) {
        actualKey = parts[1];
      }
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: actualKey,
    });

    return getSignedUrl(this.s3, command, { expiresIn });
  }

  async uploadBlogImage(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_IMAGE_TYPES);
    const key = await this.upload(file, 'blog-images');
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async uploadSettlementProof(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_DOC_TYPES);
    const key = await this.upload(file, 'settlement-proofs');
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  private validateFile(
    file: Express.Multer.File,
    allowedTypes: string[],
  ): void {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type: ${file.mimetype}. Allowed: ${allowedTypes.join(', ')}`,
      );
    }

    if (file.size > this.MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File too large. Maximum size is ${this.MAX_FILE_SIZE / (1024 * 1024)}MB`,
      );
    }
  }

  private async upload(
    file: Express.Multer.File,
    folder: string,
  ): Promise<string> {
    const ext = file.originalname.split('.').pop() || 'bin';
    const key = `${folder}/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await this.s3.send(command);
    this.logger.log(`File uploaded to S3: ${key}`);
    return key;
  }
}

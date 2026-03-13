import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor(private readonly config: ConfigService) {
    this.region = this.config.get<string>('AWS_REGION', 'ap-south-1');
    this.bucket = this.config.get<string>('AWS_BUCKET', 'pharmabag-images');

    this.s3 = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.config.get<string>('AWS_ACCESS_KEY', ''),
        secretAccessKey: this.config.get<string>('AWS_SECRET_KEY', ''),
      },
    });
  }

  private readonly ALLOWED_IMAGE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
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
    return this.upload(file, 'product-images');
  }

  async uploadPaymentProof(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_DOC_TYPES);
    return this.upload(file, 'payment-proofs');
  }

  async uploadKycDocument(file: Express.Multer.File): Promise<string> {
    this.validateFile(file, this.ALLOWED_DOC_TYPES);
    return this.upload(file, 'kyc-documents');
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

    const url = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    this.logger.log(`File uploaded: ${url}`);
    return url;
  }
}

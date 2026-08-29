import { StorageService } from './storage.service';

/**
 * Blog images are public marketing assets like product images, but live under
 * their own `blog-images/` prefix (matching where the existing live post's
 * featured image already sits) so the bucket stays organised.
 */
describe('StorageService.uploadBlogImage', () => {
  const makeService = () => {
    const service = Object.create(StorageService.prototype) as StorageService;
    (service as any).bucket = 'pharmabag03';
    (service as any).region = 'ap-south-1';
    const uploaded: Array<{ folder: string }> = [];
    (service as any).validateFile = jest.fn();
    (service as any).upload = jest.fn(async (_file: unknown, folder: string) => {
      uploaded.push({ folder });
      return `${folder}/fake-key.png`;
    });
    return { service, uploaded };
  };

  const file = {
    originalname: 'hero.png',
    mimetype: 'image/png',
    size: 1024,
  } as any;

  it('uploads under the blog-images/ prefix and returns the public URL', async () => {
    const { service, uploaded } = makeService();
    const url = await service.uploadBlogImage(file);
    expect(uploaded).toEqual([{ folder: 'blog-images' }]);
    expect(url).toBe(
      'https://pharmabag03.s3.ap-south-1.amazonaws.com/blog-images/fake-key.png',
    );
  });

  it('validates the file as an image before uploading', async () => {
    const { service } = makeService();
    await service.uploadBlogImage(file);
    expect((service as any).validateFile).toHaveBeenCalledWith(
      file,
      (service as any).ALLOWED_IMAGE_TYPES,
    );
  });
});

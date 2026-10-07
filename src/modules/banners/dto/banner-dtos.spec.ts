import { ValidationPipe } from '@nestjs/common';
import { CreateBannerDto } from './create-banner.dto';
import { UpdateBannerDto } from './update-banner.dto';
import { ReorderBannersDto } from './reorder-banners.dto';

/**
 * The admin banner form builds ONE payload and sends all of it on both create
 * and update — exactly what the seller ProductForm does, and exactly how a
 * field present on CreateProductDto but missing from UpdateProductDto made
 * every seller edit 400 for three days in September 2026. The admin saw a
 * validation error naming a field they had never touched.
 *
 * `src/main.ts` runs the global pipe with whitelist AND forbidNonWhitelisted,
 * so an undeclared property is rejected before the service is ever reached.
 * These tests drive the REAL pipe with the REAL payload so that failure cannot
 * recur here silently.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const FULL_PAYLOAD = {
  title: 'Veltam 0.4mg featured',
  imageUrl: 'https://pharmabag03.s3.ap-south-1.amazonaws.com/banner-images/a.jpg',
  mobileImageUrl:
    'https://pharmabag03.s3.ap-south-1.amazonaws.com/banner-images/a-mobile.jpg',
  altText: 'Veltam 0.4mg Tablet — better urological care',
  linkUrl: '/products/veltam-0-4mg-tablet',
  active: true,
  placements: [
    { scope: 'HOMEPAGE' },
    { scope: 'CATEGORY', categoryId: '3f1b2c44-0000-4000-8000-000000000001' },
  ],
};

const transform = (dto: unknown, metatype: new (...args: never[]) => object) =>
  pipe.transform(dto, { type: 'body', metatype });

/**
 * The pipe throws a BadRequestException whose `.message` is the generic
 * "Bad Request Exception" — every per-field complaint lives in the response
 * body. Asserting with `.rejects.toThrow(/altText/)` therefore passes or fails
 * for reasons unrelated to the field, so these tests read the real messages.
 */
async function expectRejection(
  payload: unknown,
  metatype: new (...args: never[]) => object,
  pattern: RegExp,
): Promise<void> {
  try {
    await transform(payload, metatype);
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    const raw = (response as { message?: unknown })?.message ?? response ?? error;
    const text = Array.isArray(raw) ? raw.join('; ') : String(raw);
    expect(text).toMatch(pattern);
    return;
  }
  throw new Error(`Expected the pipe to reject with ${pattern}, but it resolved`);
}

describe('banner DTOs accept the same field set', () => {
  it('CreateBannerDto accepts the full admin payload', async () => {
    await expect(transform(FULL_PAYLOAD, CreateBannerDto)).resolves.toMatchObject({
      title: 'Veltam 0.4mg featured',
      altText: 'Veltam 0.4mg Tablet — better urological care',
    });
  });

  it('UpdateBannerDto accepts the IDENTICAL payload — the form resends everything', async () => {
    await expect(transform(FULL_PAYLOAD, UpdateBannerDto)).resolves.toMatchObject({
      title: 'Veltam 0.4mg featured',
    });
  });

  it('both DTOs declare exactly the same properties', async () => {
    const created = (await transform(FULL_PAYLOAD, CreateBannerDto)) as object;
    const updated = (await transform(FULL_PAYLOAD, UpdateBannerDto)) as object;
    expect(Object.keys(updated).sort()).toEqual(Object.keys(created).sort());
  });

  it('rejects a property neither DTO declares, rather than dropping it', async () => {
    await expectRejection(
      { ...FULL_PAYLOAD, extraFields: { x: 1 } },
      CreateBannerDto,
      /extraFields should not exist/,
    );
  });

  it('rejects position — order is owned by the reorder endpoint, not by a save', async () => {
    await expectRejection(
      { ...FULL_PAYLOAD, position: 3 },
      UpdateBannerDto,
      /position should not exist/,
    );
  });

  it('requires altText — the image carries all the text there is', async () => {
    const { altText, ...withoutAlt } = FULL_PAYLOAD;
    await expectRejection(withoutAlt, CreateBannerDto, /altText/);
  });

  it('allows UpdateBannerDto to send only the field being changed', async () => {
    await expect(transform({ active: false }, UpdateBannerDto)).resolves.toEqual({
      active: false,
    });
  });

  it('rejects an unknown placement scope', async () => {
    await expectRejection(
      { ...FULL_PAYLOAD, placements: [{ scope: 'FOOTER' }] },
      CreateBannerDto,
      /scope/,
    );
  });

  it('rejects a placement carrying an undeclared property', async () => {
    await expectRejection(
      { ...FULL_PAYLOAD, placements: [{ scope: 'HOMEPAGE', weight: 2 }] },
      CreateBannerDto,
      /weight should not exist/,
    );
  });
});

describe('ReorderBannersDto', () => {
  it('accepts a non-empty list of uuids', async () => {
    await expect(
      transform({ ids: ['3f1b2c44-0000-4000-8000-000000000001'] }, ReorderBannersDto),
    ).resolves.toMatchObject({ ids: expect.any(Array) });
  });

  it('rejects an empty list', async () => {
    await expectRejection({ ids: [] }, ReorderBannersDto, /ids/);
  });
});

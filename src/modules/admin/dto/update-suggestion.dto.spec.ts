import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSuggestionDto } from './update-suggestion.dto';

describe('UpdateSuggestionDto — SEO override fields', () => {
  it('accepts all three override fields', async () => {
    const dto = plainToInstance(UpdateSuggestionDto, {
      metaTitle: 'Dolo 650 Wholesale Price — Micro Labs',
      metaDescription: 'Buy Dolo 650 in bulk at wholesale rates.',
      ogImage: 'https://pharmabag03.s3.ap-south-1.amazonaws.com/blog-images/og.png',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts empty strings — the "clear this override" instruction', async () => {
    const dto = plainToInstance(UpdateSuggestionDto, {
      metaTitle: '',
      metaDescription: '',
      ogImage: '',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an over-long metaTitle', async () => {
    const dto = plainToInstance(UpdateSuggestionDto, { metaTitle: 'x'.repeat(201) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'metaTitle')).toBe(true);
  });

  it('still validates the pre-existing fields', async () => {
    const dto = plainToInstance(UpdateSuggestionDto, { mrp: 'not-a-number' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'mrp')).toBe(true);
  });
});

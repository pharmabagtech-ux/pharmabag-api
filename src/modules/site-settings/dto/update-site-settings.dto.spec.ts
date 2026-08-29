import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSiteSettingsDto } from './update-site-settings.dto';

describe('UpdateSiteSettingsDto', () => {
  it('accepts a full valid payload', async () => {
    const dto = plainToInstance(UpdateSiteSettingsDto, {
      gscVerification: 'abc123XYZ',
      bingVerification: 'DEF456',
      ga4MeasurementId: 'G-ABC123XYZ0',
      socialProfiles: ['https://www.linkedin.com/company/pharmabag'],
      supportEmail: 'support@pharmabag.in',
      addressLocality: 'Kolkata',
      addressRegion: 'West Bengal',
      defaultOgImage:
        'https://pharmabag03.s3.ap-south-1.amazonaws.com/blog-images/og.png',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts an empty payload (every field optional)', async () => {
    const dto = plainToInstance(UpdateSiteSettingsDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a malformed GA4 measurement id', async () => {
    const dto = plainToInstance(UpdateSiteSettingsDto, {
      ga4MeasurementId: 'UA-12345-1',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'ga4MeasurementId')).toBe(true);
  });

  it('rejects a non-URL social profile', async () => {
    const dto = plainToInstance(UpdateSiteSettingsDto, {
      socialProfiles: ['not a url'],
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'socialProfiles')).toBe(true);
  });

  it('rejects a non-email supportEmail', async () => {
    const dto = plainToInstance(UpdateSiteSettingsDto, {
      supportEmail: 'not-an-email',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'supportEmail')).toBe(true);
  });
});

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
      metaPixelId: '1234567890123456',
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

  // Meta issues both 15- and 16-digit pixel ids; both must pass.
  it.each(['123456789012345', '1234567890123456'])(
    'accepts a %s-character Meta pixel id',
    async (metaPixelId) => {
      const dto = plainToInstance(UpdateSiteSettingsDto, { metaPixelId });
      expect(await validate(dto)).toHaveLength(0);
    },
  );

  // The commonest paste mistakes: the whole Events Manager URL, the ad-account
  // id (which carries an `act_` prefix), and a truncated id.
  it.each([
    'act_1234567890123456',
    'https://business.facebook.com/events_manager2/list/1234567890123456',
    '12345',
    'G-ABC123XYZ0',
  ])('rejects %s as a Meta pixel id', async (metaPixelId) => {
    const dto = plainToInstance(UpdateSiteSettingsDto, { metaPixelId });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'metaPixelId')).toBe(true);
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

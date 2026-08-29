import { SiteSettingsService, SETTINGS_ROW_ID } from './site-settings.service';

describe('SiteSettingsService', () => {
  const makeService = (stored: any | null) => {
    const prisma = {
      siteSetting: {
        findUnique: jest.fn(async () =>
          stored ? { id: SETTINGS_ROW_ID, data: stored } : null,
        ),
        upsert: jest.fn(async ({ create, update }: any) => ({
          id: SETTINGS_ROW_ID,
          data: update.data ?? create.data,
        })),
      },
    };
    return { service: new SiteSettingsService(prisma as any), prisma };
  };

  it('returns {} when no row exists', async () => {
    const { service } = makeService(null);
    expect(await service.get()).toEqual({});
  });

  it('returns ONLY whitelisted keys from the stored JSON', async () => {
    const { service } = makeService({
      ga4MeasurementId: 'G-ABC123XYZ0',
      hacked: 'nope',
      DATABASE_URL: 'leak',
    });
    expect(await service.get()).toEqual({ ga4MeasurementId: 'G-ABC123XYZ0' });
  });

  it('drops empty strings so the storefront falls back cleanly', async () => {
    const { service } = makeService({
      gscVerification: '   ',
      supportEmail: 'a@b.in',
    });
    expect(await service.get()).toEqual({ supportEmail: 'a@b.in' });
  });

  it('upserts the single row on update and returns the stored shape', async () => {
    const { service, prisma } = makeService(null);
    const result = await service.update({ ga4MeasurementId: 'G-ABC123XYZ0' });
    expect(prisma.siteSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SETTINGS_ROW_ID } }),
    );
    expect(result).toEqual({ ga4MeasurementId: 'G-ABC123XYZ0' });
  });

  it('drops empty arrays (clearing socialProfiles really clears them)', async () => {
    const { service } = makeService(null);
    const result = await service.update({ socialProfiles: [] });
    expect(result).toEqual({});
  });
});

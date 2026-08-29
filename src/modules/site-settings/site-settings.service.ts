import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { UpdateSiteSettingsDto } from './dto/update-site-settings.dto';

export const SETTINGS_ROW_ID = 'site';

/** Keys allowed OUT. Anything else in the stored JSON is never returned. */
const PUBLIC_KEYS = [
  'gscVerification',
  'bingVerification',
  'ga4MeasurementId',
  'socialProfiles',
  'supportEmail',
  'addressLocality',
  'addressRegion',
  'defaultOgImage',
] as const;

export type SiteSettingsShape = Partial<
  Record<(typeof PUBLIC_KEYS)[number], unknown>
>;

@Injectable()
export class SiteSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read the single settings row, projected onto the public whitelist.
   * The projection runs on READ as well as write, so even a row edited
   * outside the API (manual SQL) can never leak an unexpected key to the
   * public endpoint.
   */
  async get(): Promise<SiteSettingsShape> {
    const row = await this.prisma.siteSetting.findUnique({
      where: { id: SETTINGS_ROW_ID },
    });
    return this.project((row?.data as Record<string, unknown>) ?? {});
  }

  async update(dto: UpdateSiteSettingsDto): Promise<SiteSettingsShape> {
    // The projected shape is plain strings/string-arrays by construction
    // (DTO-validated), so the InputJsonValue cast is safe.
    const data = this.project(dto as Record<string, unknown>) as Prisma.InputJsonValue;
    const row = await this.prisma.siteSetting.upsert({
      where: { id: SETTINGS_ROW_ID },
      create: { id: SETTINGS_ROW_ID, data },
      update: { data },
    });
    return this.project(row.data as Record<string, unknown>);
  }

  private project(raw: Record<string, unknown>): SiteSettingsShape {
    const out: Record<string, unknown> = {};
    for (const key of PUBLIC_KEYS) {
      const value = raw[key];
      if (value === undefined || value === null) continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      if (Array.isArray(value) && value.length === 0) continue;
      out[key] = value;
    }
    return out;
  }
}

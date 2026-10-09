/**
 * Analytics recorded device, OS, browser and referral source but no location,
 * so "where are our visitors" could not be answered at all — the ingest proxy
 * had explicitly deferred geo. These cover the two pure functions that decide
 * what location gets stored, because both have failure modes that silently
 * corrupt every row rather than erroring:
 *
 *  - `firstPublicIp`: taking X-Forwarded-For[0] blindly geo-locates our own
 *    nginx for every visitor, since same-box requests arrive as
 *    "127.0.0.1, <real ip>". Every session would report one bogus city.
 *  - `normalizeGeo`: MaxMind returns partial records and empty strings. An
 *    empty string stored as-is splits each report into a real bucket and a
 *    blank one that both mean "unknown".
 */
import { firstPublicIp, normalizeGeo, EMPTY_GEO } from './geo-resolver';
import type { CityResponse } from 'maxmind';

describe('firstPublicIp', () => {
  it('returns null when the header is absent or empty', () => {
    expect(firstPublicIp(undefined)).toBeNull();
    expect(firstPublicIp(null)).toBeNull();
    expect(firstPublicIp('')).toBeNull();
    expect(firstPublicIp('   ')).toBeNull();
  });

  it('takes the single client address', () => {
    expect(firstPublicIp('49.36.12.7')).toBe('49.36.12.7');
  });

  it('takes the left-most public address from a proxy chain', () => {
    expect(firstPublicIp('49.36.12.7, 10.0.0.5, 172.31.4.9')).toBe('49.36.12.7');
  });

  it('skips a leading loopback hop instead of geo-locating our own server', () => {
    // The regression this file exists for: nginx on the same box prepends
    // 127.0.0.1, so position 0 is not the client.
    expect(firstPublicIp('127.0.0.1, 49.36.12.7')).toBe('49.36.12.7');
  });

  it('skips every private range', () => {
    expect(firstPublicIp('10.1.2.3, 192.168.1.9, 172.16.0.4, 49.36.12.7')).toBe('49.36.12.7');
    expect(firstPublicIp('169.254.1.1, 49.36.12.7')).toBe('49.36.12.7');
  });

  it('treats 172.16-172.31 as private but 172.32 as public', () => {
    expect(firstPublicIp('172.20.5.5')).toBeNull();
    expect(firstPublicIp('172.32.5.5')).toBe('172.32.5.5');
    expect(firstPublicIp('172.15.5.5')).toBe('172.15.5.5');
  });

  it('returns null when the whole chain is private', () => {
    expect(firstPublicIp('127.0.0.1, 10.0.0.1, 192.168.0.1')).toBeNull();
  });

  it('handles IPv6 loopback and unique-local addresses', () => {
    expect(firstPublicIp('::1')).toBeNull();
    expect(firstPublicIp('fe80::1')).toBeNull();
    expect(firstPublicIp('fd00::1')).toBeNull();
    expect(firstPublicIp('::1, 2405:201:1::5')).toBe('2405:201:1::5');
  });

  it('strips a port suffix and IPv6 brackets', () => {
    expect(firstPublicIp('49.36.12.7:54321')).toBe('49.36.12.7');
    expect(firstPublicIp('[2405:201:1::5]')).toBe('2405:201:1::5');
  });
});

describe('normalizeGeo', () => {
  it('returns all-null geo for a missing response', () => {
    expect(normalizeGeo(null)).toEqual(EMPTY_GEO);
    expect(normalizeGeo(undefined)).toEqual(EMPTY_GEO);
  });

  it('extracts country, state and city from a full Indian record', () => {
    const response = {
      country: { iso_code: 'IN', names: { en: 'India' } },
      subdivisions: [{ iso_code: 'MH', names: { en: 'Maharashtra' } }],
      city: { names: { en: 'Mumbai' } },
    } as unknown as CityResponse;

    expect(normalizeGeo(response)).toEqual({
      countryCode: 'IN',
      country: 'India',
      region: 'Maharashtra',
      regionCode: 'MH',
      city: 'Mumbai',
    });
  });

  it('keeps a known country when the city is unknown', () => {
    // Very common for mobile-carrier IP ranges in India.
    const response = {
      country: { iso_code: 'IN', names: { en: 'India' } },
    } as unknown as CityResponse;

    expect(normalizeGeo(response)).toEqual({
      countryCode: 'IN',
      country: 'India',
      region: null,
      regionCode: null,
      city: null,
    });
  });

  it('collapses empty and whitespace-only names to null, not blank buckets', () => {
    const response = {
      country: { iso_code: 'IN', names: { en: 'India' } },
      subdivisions: [{ iso_code: '', names: { en: '   ' } }],
      city: { names: { en: '' } },
    } as unknown as CityResponse;

    expect(normalizeGeo(response)).toEqual({
      countryCode: 'IN',
      country: 'India',
      region: null,
      regionCode: null,
      city: null,
    });
  });

  it('uppercases the country code', () => {
    const response = {
      country: { iso_code: 'in', names: { en: 'India' } },
    } as unknown as CityResponse;

    expect(normalizeGeo(response).countryCode).toBe('IN');
  });

  it('takes the broadest subdivision as the state', () => {
    // MaxMind orders subdivisions broadest-first; for India the second entry
    // is a district, which must not be reported as the state.
    const response = {
      country: { iso_code: 'IN', names: { en: 'India' } },
      subdivisions: [
        { iso_code: 'GJ', names: { en: 'Gujarat' } },
        { iso_code: 'ST', names: { en: 'Surat' } },
      ],
    } as unknown as CityResponse;

    const geo = normalizeGeo(response);
    expect(geo.region).toBe('Gujarat');
    expect(geo.regionCode).toBe('GJ');
  });

  it('truncates absurdly long localised names rather than failing the insert', () => {
    const response = {
      country: { iso_code: 'IN', names: { en: 'x'.repeat(500) } },
    } as unknown as CityResponse;

    expect(normalizeGeo(response).country).toHaveLength(120);
  });
});

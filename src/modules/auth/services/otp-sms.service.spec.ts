/**
 * OTP SMS delivery stopped reaching handsets on 2026-10-20 while the Nimbus
 * gateway kept returning Status:"OK" with a Message ID for every send — the
 * classic signature of DLT-side filtering, where the operator accepts a
 * message and then drops it because the body no longer matches an approved
 * template.
 *
 * The DLT team issued a new template:
 *   id   : 1707164786061344379
 *   text : "Use OTP {#var#} to login to your Pharmabag account"
 *
 * Two things have to hold for that template to pass scrubbing, and both are
 * easy to break silently:
 *
 *   1. The {#var#} placeholder must actually be substituted. The old template
 *      used {otp}; if the replacement regex ever stops covering {#var#} the
 *      literal placeholder goes out over the wire and every message is
 *      rejected, with no error visible on our side.
 *   2. Everything around the placeholder must survive untouched. The old body
 *      was prefixed with "Welcome to Pharmabag." — re-introducing any such
 *      drift puts us straight back into silent filtering.
 *
 * Phone formatting is covered here too: the DLT team asked for the 91 country
 * code on every number, which formatPhone already does. These tests pin that
 * down so it cannot regress.
 */
import { ConfigService } from '@nestjs/config';
import { OtpSmsService } from './otp-sms.service';

const makeService = (overrides: Record<string, string> = {}) => {
  const config = {
    get: (key: string) => overrides[key],
  } as unknown as ConfigService;
  return new OtpSmsService(config);
};

describe('OtpSmsService — DLT template', () => {
  it('defaults to the approved template text and id', () => {
    const service = makeService();

    expect(service.getTemplate()).toBe(
      'Use OTP {#var#} to login to your Pharmabag account',
    );
    expect(service['templateId']).toBe('1707164786061344379');
  });

  it('substitutes {#var#} with the OTP and leaves the rest of the body intact', () => {
    const service = makeService();

    const rendered = service.getTemplate().replace(
      /\{otp\}|\[otp\]|<otp>|\{#var#\}|\{%otp%\}/gi,
      '483921',
    );

    expect(rendered).toBe(
      'Use OTP 483921 to login to your Pharmabag account',
    );
    // The placeholder must be gone — a literal {#var#} on the wire is rejected.
    expect(rendered).not.toContain('#var#');
    // Guard against the pre-2026-10-24 body creeping back in.
    expect(rendered).not.toContain('Welcome to Pharmabag');
  });

  it('still honours an env override for the template', () => {
    const service = makeService({
      NIMBUS_OTP_MESSAGE: 'Use OTP {#var#} to sign in',
      NIMBUS_TEMPLATE_ID: '999',
    });

    expect(service.getTemplate()).toBe('Use OTP {#var#} to sign in');
    expect(service['templateId']).toBe('999');
  });
});

describe('OtpSmsService — phone formatting', () => {
  it('prefixes 91 on a bare 10-digit Indian number', () => {
    const service = makeService();
    expect(service['formatPhone']('9052137200')).toBe('919052137200');
  });

  it('does not double-prefix a number that already carries 91', () => {
    const service = makeService();
    expect(service['formatPhone']('919052137200')).toBe('919052137200');
  });

  it('converts a leading 0 trunk prefix to 91', () => {
    const service = makeService();
    expect(service['formatPhone']('09052137200')).toBe('919052137200');
  });

  it('strips formatting characters before deciding', () => {
    const service = makeService();
    expect(service['formatPhone']('+91 90521-37200')).toBe('919052137200');
    expect(service['formatPhone']('90521 37200')).toBe('919052137200');
  });
});

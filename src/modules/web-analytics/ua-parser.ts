/**
 * Minimal dependency-free user-agent classification: device type, OS, and
 * browser family for analytics breakdowns — not a full parser. Order of
 * checks matters throughout — e.g. Edge contains "Chrome", Chrome contains
 * "Safari", Android contains "Linux", ChromeOS contains "Linux".
 *
 * Bot detection is NOT this file's job — see bot-detector.ts, which already
 * handles that independently. Duplicating it here would create two sources
 * of truth that could disagree.
 */

export interface ParsedUa {
  deviceType: 'desktop' | 'mobile' | 'tablet';
  os: string;
  browser: string;
}

export function parseDeviceOsBrowser(ua: string | null | undefined): ParsedUa {
  const s = (ua ?? '').trim();
  if (!s) return { deviceType: 'desktop', os: 'Unknown', browser: 'Unknown' };

  // Device type: tablet before mobile before desktop — Android tablets lack
  // "Mobile" in their UA, so the tablet check must exclude that case first.
  let deviceType: ParsedUa['deviceType'] = 'desktop';
  if (/ipad|tablet|kindle|silk|playbook/i.test(s) || (/android/i.test(s) && !/mobile/i.test(s))) deviceType = 'tablet';
  else if (/iphone|ipod|android.*mobile|windows phone|blackberry|opera mini/i.test(s)) deviceType = 'mobile';

  let os = 'Other';
  if (/windows nt/i.test(s)) os = 'Windows';
  else if (/iphone|ipad|ipod/i.test(s)) os = 'iOS';
  else if (/android/i.test(s)) os = 'Android';
  else if (/mac os x|macintosh/i.test(s)) os = 'macOS';
  else if (/cros/i.test(s)) os = 'ChromeOS';
  else if (/linux/i.test(s)) os = 'Linux';

  let browser = 'Other';
  if (/edg(e|a|ios)?\//i.test(s)) browser = 'Edge';
  else if (/samsungbrowser\//i.test(s)) browser = 'Samsung Internet';
  else if (/opr\/|opera/i.test(s)) browser = 'Opera';
  else if (/firefox\/|fxios\//i.test(s)) browser = 'Firefox';
  else if (/crios\//i.test(s)) browser = 'Chrome';
  else if (/chrome\//i.test(s)) browser = 'Chrome';
  else if (/safari\//i.test(s) && /version\//i.test(s)) browser = 'Safari';
  else if (/instagram/i.test(s)) browser = 'Instagram in-app';
  else if (/fbav|fb_iab/i.test(s)) browser = 'Facebook in-app';

  return { deviceType, os, browser };
}

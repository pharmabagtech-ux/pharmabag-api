/**
 * Classifies raw acquisition evidence (referrer / UTM / ad click ids) into
 * a channel category, computed once at ingest time and stamped onto the
 * session (see WebAnalyticsService.ingest). Ported from Yukizi's reference
 * classifier; the ANDROID_APP_RULES branch is dropped — PharmaBag has no
 * native app, so android-app:// referrers never occur here.
 *
 * Evidence priority (strongest wins):
 *   1. Ad click ids (gclid/fbclid/msclkid/ttclid) -> PAID
 *   2. UTM parameters                              -> mapped category
 *   3. Referrer domain                              -> mapped via DOMAIN_RULES
 *   4. No referrer at all                           -> DIRECT
 *
 * "DIRECT" strictly means "the browser provided no referrer information" —
 * it must never be presented as "typed the URL". An unrecognized referrer
 * domain is REFERRAL with the real domain preserved, never dropped to
 * DIRECT/UNKNOWN.
 */

export type SourceCategory =
  | 'ORGANIC_SEARCH'
  | 'AI'
  | 'SOCIAL'
  | 'VIDEO'
  | 'REFERRAL'
  | 'DIRECT'
  | 'PAID'
  | 'EMAIL'
  | 'MESSAGING'
  | 'UNKNOWN';

export type AttributionLevel = 'UTM' | 'CLICK_ID' | 'REFERRER' | 'DIRECT' | 'UNKNOWN';

export interface ClassifierInput {
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  clickIds?: Partial<Record<'gclid' | 'fbclid' | 'msclkid' | 'ttclid', string>> | null;
}

export interface ClassifiedSource {
  source: string;
  category: SourceCategory;
  level: AttributionLevel;
  referrerDomain: string | null;
}

interface DomainRule {
  match: RegExp;
  source: string;
  category: SourceCategory;
}

// Order matters: first match wins. Email webmail takes priority (must not be shadowed by generic
// Google/Yahoo rules). AI assistants sit above generic search (gemini.google.com must not fall
// through to Google Search).
const DOMAIN_RULES: DomainRule[] = [
  { match: /^mail\.google\.com$|(^|\.)outlook\.(com|live\.com)$|^mail\.yahoo\.com$/, source: 'Email (webmail)', category: 'EMAIL' },

  { match: /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/, source: 'ChatGPT', category: 'AI' },
  { match: /(^|\.)openai\.com$/, source: 'OpenAI', category: 'AI' },
  { match: /^gemini\.google\.com$|^bard\.google\.com$|^aistudio\.google\.com$/, source: 'Google Gemini', category: 'AI' },
  { match: /(^|\.)claude\.ai$|(^|\.)anthropic\.com$/, source: 'Claude', category: 'AI' },
  { match: /(^|\.)perplexity\.ai$/, source: 'Perplexity', category: 'AI' },
  { match: /^copilot\.microsoft\.com$|(^|\.)bing\.com\/chat$/, source: 'Microsoft Copilot', category: 'AI' },
  { match: /(^|\.)you\.com$/, source: 'You.com', category: 'AI' },
  { match: /(^|\.)phind\.com$/, source: 'Phind', category: 'AI' },
  { match: /(^|\.)poe\.com$/, source: 'Poe', category: 'AI' },
  { match: /(^|\.)meta\.ai$/, source: 'Meta AI', category: 'AI' },
  { match: /(^|\.)mistral\.ai$|(^|\.)lechat\.mistral\.ai$/, source: 'Mistral', category: 'AI' },
  { match: /(^|\.)grok\.com$|^grok\.x\.com$/, source: 'Grok', category: 'AI' },
  { match: /(^|\.)deepseek\.com$/, source: 'DeepSeek', category: 'AI' },

  { match: /(^|\.)google\.[a-z.]{1,8}$/, source: 'Google', category: 'ORGANIC_SEARCH' },
  { match: /(^|\.)bing\.com$/, source: 'Bing', category: 'ORGANIC_SEARCH' },
  { match: /(^|\.)duckduckgo\.com$/, source: 'DuckDuckGo', category: 'ORGANIC_SEARCH' },
  { match: /(^|\.)search\.yahoo\.com$|(^|\.)yahoo\.com$/, source: 'Yahoo', category: 'ORGANIC_SEARCH' },
  { match: /(^|\.)search\.brave\.com$/, source: 'Brave Search', category: 'ORGANIC_SEARCH' },
  { match: /(^|\.)ecosia\.org$/, source: 'Ecosia', category: 'ORGANIC_SEARCH' },
  { match: /(^|\.)startpage\.com$/, source: 'Startpage', category: 'ORGANIC_SEARCH' },
  { match: /(^|\.)yandex\.(com|ru)$/, source: 'Yandex', category: 'ORGANIC_SEARCH' },
  { match: /(^|\.)baidu\.com$/, source: 'Baidu', category: 'ORGANIC_SEARCH' },

  { match: /(^|\.)youtube\.com$|^youtu\.be$/, source: 'YouTube', category: 'VIDEO' },

  { match: /(^|\.)instagram\.com$/, source: 'Instagram', category: 'SOCIAL' },
  { match: /(^|\.)facebook\.com$|^fb\.me$|^m\.facebook\.com$|^l\.facebook\.com$|^lm\.facebook\.com$/, source: 'Facebook', category: 'SOCIAL' },
  { match: /(^|\.)twitter\.com$|(^|\.)x\.com$|^t\.co$/, source: 'X (Twitter)', category: 'SOCIAL' },
  { match: /(^|\.)linkedin\.com$|^lnkd\.in$/, source: 'LinkedIn', category: 'SOCIAL' },
  { match: /(^|\.)reddit\.com$|^redd\.it$|^out\.reddit\.com$/, source: 'Reddit', category: 'SOCIAL' },
  { match: /(^|\.)pinterest\.[a-z.]+$|^pin\.it$/, source: 'Pinterest', category: 'SOCIAL' },
  { match: /(^|\.)tiktok\.com$/, source: 'TikTok', category: 'SOCIAL' },
  { match: /(^|\.)threads\.net$|(^|\.)threads\.com$/, source: 'Threads', category: 'SOCIAL' },
  { match: /(^|\.)snapchat\.com$/, source: 'Snapchat', category: 'SOCIAL' },

  { match: /(^|\.)whatsapp\.com$|^wa\.me$|^web\.whatsapp\.com$/, source: 'WhatsApp', category: 'MESSAGING' },
  { match: /(^|\.)telegram\.(org|me)$|^t\.me$|^web\.telegram\.org$/, source: 'Telegram', category: 'MESSAGING' },
];

const UTM_SOURCE_MAP: Record<string, { source: string; category: SourceCategory }> = {
  google: { source: 'Google', category: 'ORGANIC_SEARCH' },
  bing: { source: 'Bing', category: 'ORGANIC_SEARCH' },
  chatgpt: { source: 'ChatGPT', category: 'AI' },
  openai: { source: 'ChatGPT', category: 'AI' },
  gemini: { source: 'Google Gemini', category: 'AI' },
  claude: { source: 'Claude', category: 'AI' },
  perplexity: { source: 'Perplexity', category: 'AI' },
  copilot: { source: 'Microsoft Copilot', category: 'AI' },
  facebook: { source: 'Facebook', category: 'SOCIAL' },
  fb: { source: 'Facebook', category: 'SOCIAL' },
  instagram: { source: 'Instagram', category: 'SOCIAL' },
  ig: { source: 'Instagram', category: 'SOCIAL' },
  youtube: { source: 'YouTube', category: 'VIDEO' },
  twitter: { source: 'X (Twitter)', category: 'SOCIAL' },
  x: { source: 'X (Twitter)', category: 'SOCIAL' },
  linkedin: { source: 'LinkedIn', category: 'SOCIAL' },
  reddit: { source: 'Reddit', category: 'SOCIAL' },
  pinterest: { source: 'Pinterest', category: 'SOCIAL' },
  tiktok: { source: 'TikTok', category: 'SOCIAL' },
  whatsapp: { source: 'WhatsApp', category: 'MESSAGING' },
  telegram: { source: 'Telegram', category: 'MESSAGING' },
  email: { source: 'Email', category: 'EMAIL' },
  newsletter: { source: 'Email', category: 'EMAIL' },
};

const PAID_MEDIUMS = /^(cpc|ppc|cpm|cpv|cpa|paid|paidsocial|paid_social|paid-social|display|banner|retargeting)$/i;
const EMAIL_MEDIUMS = /^(email|e-mail|newsletter)$/i;
const SOCIAL_MEDIUMS = /^(social|social-network|social-media|sm)$/i;

/** Hostname (lowercased, no port/www) from a referrer URL or bare host. Null when unparseable. */
export function referrerDomain(referrer?: string | null): string | null {
  if (!referrer) return null;
  const raw = referrer.trim();
  if (!raw) return null;
  try {
    const host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
    return host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export function classifySource(input: ClassifierInput): ClassifiedSource {
  const domain = referrerDomain(input.referrer);
  const utmSource = input.utmSource?.trim().toLowerCase() || null;
  const utmMedium = input.utmMedium?.trim().toLowerCase() || null;
  const clickIds = input.clickIds ?? {};

  if (clickIds.gclid) return { source: 'Google Ads', category: 'PAID', level: 'CLICK_ID', referrerDomain: domain };
  if (clickIds.fbclid) return { source: 'Meta Ads', category: 'PAID', level: 'CLICK_ID', referrerDomain: domain };
  if (clickIds.msclkid) return { source: 'Microsoft Ads', category: 'PAID', level: 'CLICK_ID', referrerDomain: domain };
  if (clickIds.ttclid) return { source: 'TikTok Ads', category: 'PAID', level: 'CLICK_ID', referrerDomain: domain };

  if (utmSource) {
    const mapped = UTM_SOURCE_MAP[utmSource];
    if (utmMedium && PAID_MEDIUMS.test(utmMedium)) {
      return { source: mapped ? `${mapped.source} (paid)` : `${utmSource} (paid)`, category: 'PAID', level: 'UTM', referrerDomain: domain };
    }
    if (utmMedium && EMAIL_MEDIUMS.test(utmMedium)) {
      return { source: 'Email', category: 'EMAIL', level: 'UTM', referrerDomain: domain };
    }
    if (mapped) return { source: mapped.source, category: mapped.category, level: 'UTM', referrerDomain: domain };
    if (utmMedium && SOCIAL_MEDIUMS.test(utmMedium)) {
      return { source: utmSource, category: 'SOCIAL', level: 'UTM', referrerDomain: domain };
    }
    return { source: utmSource, category: 'REFERRAL', level: 'UTM', referrerDomain: domain };
  }

  if (domain) {
    for (const rule of DOMAIN_RULES) {
      if (rule.match.test(domain)) {
        return { source: rule.source, category: rule.category, level: 'REFERRER', referrerDomain: domain };
      }
    }
    return { source: domain, category: 'REFERRAL', level: 'REFERRER', referrerDomain: domain };
  }

  return { source: 'Direct', category: 'DIRECT', level: 'DIRECT', referrerDomain: null };
}

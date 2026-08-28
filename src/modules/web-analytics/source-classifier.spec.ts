import { classifySource, referrerDomain } from './source-classifier';

describe('referrerDomain', () => {
  it.each([
    ['https://www.google.com/search?q=x', 'google.com'],
    ['https://chatgpt.com/', 'chatgpt.com'],
    ['http://m.facebook.com/story', 'm.facebook.com'],
    ['gemini.google.com', 'gemini.google.com'],
    ['', null],
    [null, null],
    ['::::not a url::::', null],
  ])('%s -> %s', (input, expected) => {
    expect(referrerDomain(input as string | null)).toBe(expected);
  });
});

describe('classifySource', () => {
  const cases: Array<{
    name: string;
    input: Parameters<typeof classifySource>[0];
    source: string;
    category: string;
    level: string;
  }> = [
    { name: 'ChatGPT web', input: { referrer: 'https://chatgpt.com/' }, source: 'ChatGPT', category: 'AI', level: 'REFERRER' },
    { name: 'ChatGPT legacy domain', input: { referrer: 'https://chat.openai.com/c/abc' }, source: 'ChatGPT', category: 'AI', level: 'REFERRER' },
    { name: 'Gemini', input: { referrer: 'https://gemini.google.com/app' }, source: 'Google Gemini', category: 'AI', level: 'REFERRER' },
    { name: 'Claude', input: { referrer: 'https://claude.ai/chat/x' }, source: 'Claude', category: 'AI', level: 'REFERRER' },
    { name: 'Perplexity', input: { referrer: 'https://www.perplexity.ai/search' }, source: 'Perplexity', category: 'AI', level: 'REFERRER' },
    { name: 'Copilot', input: { referrer: 'https://copilot.microsoft.com/' }, source: 'Microsoft Copilot', category: 'AI', level: 'REFERRER' },

    { name: 'Google search', input: { referrer: 'https://www.google.com/' }, source: 'Google', category: 'ORGANIC_SEARCH', level: 'REFERRER' },
    { name: 'Google India', input: { referrer: 'https://www.google.co.in/url' }, source: 'Google', category: 'ORGANIC_SEARCH', level: 'REFERRER' },
    { name: 'Gmail webmail (must not be shadowed by generic Google rule)', input: { referrer: 'https://mail.google.com/mail/u/0/' }, source: 'Email (webmail)', category: 'EMAIL', level: 'REFERRER' },
    { name: 'Yahoo webmail (must not be shadowed by generic Yahoo rule)', input: { referrer: 'https://mail.yahoo.com/d/folders/1' }, source: 'Email (webmail)', category: 'EMAIL', level: 'REFERRER' },
    { name: 'Outlook webmail', input: { referrer: 'https://outlook.live.com/mail/0/' }, source: 'Email (webmail)', category: 'EMAIL', level: 'REFERRER' },
    { name: 'Bounded Google rule rejects an over-long spoofed suffix', input: { referrer: 'https://google.evilsite.com/' }, source: 'google.evilsite.com', category: 'REFERRAL', level: 'REFERRER' },
    { name: 'Bing', input: { referrer: 'https://www.bing.com/search' }, source: 'Bing', category: 'ORGANIC_SEARCH', level: 'REFERRER' },
    { name: 'DuckDuckGo', input: { referrer: 'https://duckduckgo.com/' }, source: 'DuckDuckGo', category: 'ORGANIC_SEARCH', level: 'REFERRER' },

    { name: 'Instagram', input: { referrer: 'https://l.instagram.com/' }, source: 'Instagram', category: 'SOCIAL', level: 'REFERRER' },
    { name: 'Facebook mobile', input: { referrer: 'https://m.facebook.com/' }, source: 'Facebook', category: 'SOCIAL', level: 'REFERRER' },
    { name: 'X shortener', input: { referrer: 'https://t.co/abc' }, source: 'X (Twitter)', category: 'SOCIAL', level: 'REFERRER' },
    { name: 'YouTube', input: { referrer: 'https://www.youtube.com/watch' }, source: 'YouTube', category: 'VIDEO', level: 'REFERRER' },
    { name: 'Reddit outbound', input: { referrer: 'https://out.reddit.com/' }, source: 'Reddit', category: 'SOCIAL', level: 'REFERRER' },
    { name: 'WhatsApp', input: { referrer: 'https://wa.me/' }, source: 'WhatsApp', category: 'MESSAGING', level: 'REFERRER' },
    { name: 'Telegram t.me', input: { referrer: 'https://t.me/channel' }, source: 'Telegram', category: 'MESSAGING', level: 'REFERRER' },

    { name: 'Unknown blog', input: { referrer: 'https://some-anime-blog.example.net/post' }, source: 'some-anime-blog.example.net', category: 'REFERRAL', level: 'REFERRER' },

    { name: 'UTM instagram over google referrer', input: { referrer: 'https://google.com', utmSource: 'instagram' }, source: 'Instagram', category: 'SOCIAL', level: 'UTM' },
    { name: 'UTM chatgpt', input: { utmSource: 'chatgpt' }, source: 'ChatGPT', category: 'AI', level: 'UTM' },
    { name: 'UTM paid medium', input: { utmSource: 'google', utmMedium: 'cpc' }, source: 'Google (paid)', category: 'PAID', level: 'UTM' },
    { name: 'UTM email medium', input: { utmSource: 'mailchimp', utmMedium: 'email' }, source: 'Email', category: 'EMAIL', level: 'UTM' },
    { name: 'UTM unknown source', input: { utmSource: 'partner-site' }, source: 'partner-site', category: 'REFERRAL', level: 'UTM' },

    { name: 'gclid', input: { referrer: 'https://google.com', utmSource: 'google', clickIds: { gclid: 'x' } }, source: 'Google Ads', category: 'PAID', level: 'CLICK_ID' },
    { name: 'fbclid', input: { referrer: 'https://l.facebook.com', clickIds: { fbclid: 'y' } }, source: 'Meta Ads', category: 'PAID', level: 'CLICK_ID' },

    { name: 'no referrer = Direct', input: {}, source: 'Direct', category: 'DIRECT', level: 'DIRECT' },
  ];

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_label, c) => {
    const result = classifySource(c.input);
    expect(result.source).toBe(c.source);
    expect(result.category).toBe(c.category);
    expect(result.level).toBe(c.level);
  });

  it('keeps the raw referrer domain for drill-down even when UTM wins', () => {
    const r = classifySource({ referrer: 'https://news.ycombinator.com/item', utmSource: 'instagram' });
    expect(r.referrerDomain).toBe('news.ycombinator.com');
  });
});

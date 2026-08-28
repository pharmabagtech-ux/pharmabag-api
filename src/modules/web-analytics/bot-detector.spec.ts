import { isBotUserAgent } from './bot-detector';

describe('isBotUserAgent', () => {
  it('flags well-known crawler UAs', () => {
    expect(
      isBotUserAgent(
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      ),
    ).toBe(true);
    expect(
      isBotUserAgent(
        'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      ),
    ).toBe(true);
    expect(
      isBotUserAgent(
        'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) GPTBot/1.0',
      ),
    ).toBe(true);
    expect(isBotUserAgent('ClaudeBot/1.0; +claudebot@anthropic.com')).toBe(
      true,
    );
    expect(isBotUserAgent('Mozilla/5.0 (compatible; PerplexityBot/1.0)')).toBe(
      true,
    );
    expect(
      isBotUserAgent(
        'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
      ),
    ).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (compatible; SemrushBot/7~bl)')).toBe(
      true,
    );
  });

  it('flags generic tooling UAs', () => {
    expect(isBotUserAgent('curl/8.4.0')).toBe(true);
    expect(isBotUserAgent('Wget/1.21.3')).toBe(true);
    expect(isBotUserAgent('python-requests/2.31.0')).toBe(true);
    expect(
      isBotUserAgent('Mozilla/5.0 HeadlessChrome/120.0.0.0 Safari/537.36'),
    ).toBe(true);
  });

  it('flags generic bot/crawler/spider tokens', () => {
    expect(isBotUserAgent('SomeInternalTool-crawler/1.0')).toBe(true);
    expect(isBotUserAgent('MySpider v2')).toBe(true);
    expect(isBotUserAgent('WeirdBot')).toBe(true);
  });

  it('does not flag ordinary browser UAs', () => {
    expect(
      isBotUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ),
    ).toBe(false);
    expect(
      isBotUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(false);
    expect(
      isBotUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      ),
    ).toBe(false);
  });

  it('treats a missing user agent as a bot (never a plausible real browser)', () => {
    expect(isBotUserAgent(undefined)).toBe(true);
    expect(isBotUserAgent('')).toBe(true);
  });
});

/**
 * UA-substring heuristic, computed once per session at ingest time (not
 * per-event) and stamped onto the session and every event in it.
 *
 * Known limitation, accepted deliberately: this won't catch a bot that
 * doesn't identify itself, and a legitimate tool with an unusual UA could
 * theoretically be miscounted. Good enough to keep obvious crawler noise
 * out of the Real-time "active now" count; not a security boundary.
 */
const BOT_TOKENS = [
  'bot',
  'crawler',
  'spider',
  'curl',
  'wget',
  'python-requests',
  'headless',
  'googlebot',
  'bingbot',
  'gptbot',
  'oai-searchbot',
  'claudebot',
  'claude-web',
  'perplexitybot',
  'ahrefsbot',
  'semrushbot',
  'mj12bot',
  'google-extended',
];

export function isBotUserAgent(ua: string | undefined | null): boolean {
  if (!ua || ua.trim() === '') return true;
  const lower = ua.toLowerCase();
  return BOT_TOKENS.some((token) => lower.includes(token));
}

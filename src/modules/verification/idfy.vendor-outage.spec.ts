import { IdfyService } from './idfy.service';

/**
 * Masters India (our GST/PAN vendor) had an intermittent infrastructure
 * failure: /oauth/access_token returned 502 on roughly three attempts in four,
 * /searchgstin alternated between 502 and 200 and once took 35.8 seconds, and
 * earlier samples returned clean 504s at ~10.1s.
 *
 * We turned one vendor outage into three different lies:
 *
 *   1. "Failed to obtain access token"  — a raw internal string in a toast.
 *   2. "GST Number is invalid"          — told a seller with a perfectly valid
 *                                         GSTIN that their document was bad.
 *   3. "Network error..."               — the 35s vendor call blew past the
 *                                         buyer's 30s axios timeout, so no
 *                                         HTTP response ever arrived.
 *
 * These tests pin the three properties that stop that happening again:
 *
 *   - a broken vendor is reported as a broken vendor, never as a bad document;
 *   - transient failures are retried, so an intermittent vendor still works;
 *   - the whole verification finishes inside a shared budget well under the
 *     buyer's 30s client timeout, even on the two-call PAN path.
 */

const CONFIGURED_ENV = {
  MASTERS_INDIA_CLIENT_ID: 'client-id',
  MASTERS_INDIA_CLIENT_SECRET: 'client-secret',
  MASTERS_INDIA_USERNAME: 'user',
  MASTERS_INDIA_PASSWORD: 'pass',
} as Record<string, string>;

const UNAVAILABLE =
  'Verification service is temporarily unavailable. Please try again in a few minutes.';

/** The exact string that must never reach a user again. */
const LEAKED_INTERNAL_STRING = 'Failed to obtain access token';

/** An error shaped like the one the real transport rejects with. */
const httpError = (status: number, body = 'Bad Gateway') =>
  Object.assign(new Error(`Masters India API HTTP ${status}: ${body}`), {
    statusCode: status,
    responseBody: body,
  });

/** A socket-level failure, as Node reports it. */
const networkError = (code: string) =>
  Object.assign(new Error(`socket failure (${code})`), { code });

/** Plays the given results in order, repeating the last one forever. */
const seq = (...items: any[]) => {
  let i = 0;
  return () => {
    const item = items[Math.min(i, items.length - 1)];
    i += 1;
    return item instanceof Error ? Promise.reject(item) : Promise.resolve(item);
  };
};

const OAUTH_OK = { access_token: 'token-1', expires_in: 3600 };

/** A real-shaped /searchgstin hit. */
const GSTIN_HIT = {
  error: false,
  data: {
    lgnm: 'THE ERA OF MARKETING',
    tradeNam: 'THE ERA OF MARKETING',
    nba: ['Retail Business'],
    pradr: {
      addr: { bnm: 'Jamuna Apartment', city: 'Kolkata', pncd: '700048' },
    },
  },
};

/** The vendor answered, and has no such registration. */
const GSTIN_MISS = { error: false, data: null };

/** A PAN that is registered for GST. */
const SEARCHPAN_HIT = {
  error: false,
  data: [{ gstin: '19CEWPR5040D1ZW', lgnm: 'RISHIRAJ RATERIA', sts: 'Active' }],
};
const SEARCHPAN_EMPTY = { error: false, data: [] };
const PANDETAIL_VALID = {
  error: false,
  data: {
    response: {
      number: 'CEWPR5040D',
      name: 'RISHIRAJ RATERIA',
      isValid: true,
      panStatus: 'VALID',
    },
  },
};

interface Harness {
  service: IdfyService;
  getUrls: string[];
  getTokens: string[];
  oauthCalls: number;
  logs: string[];
  counts: () => { gets: number; oauths: number };
}

/**
 * Mocks at the TRANSPORT boundary (makeGetRequest / makePostRequest) rather
 * than at getAccessToken, so retry, budget and token-invalidation logic are
 * all really exercised.
 */
function harness(opts: {
  oauth?: () => Promise<any>;
  get?: (url: string) => Promise<any>;
}): Harness {
  const service = new IdfyService({
    get: (key: string) => CONFIGURED_ENV[key],
  } as any);

  const getUrls: string[] = [];
  const getTokens: string[] = [];
  const logs: string[] = [];
  let oauthCalls = 0;

  const oauth = opts.oauth ?? seq(OAUTH_OK);
  const get = opts.get ?? seq(GSTIN_HIT);

  (service as any).makePostRequest = jest.fn((_url: string) => {
    oauthCalls += 1;
    return oauth();
  });

  (service as any).makeGetRequest = jest.fn((url: string, token: string) => {
    getUrls.push(url);
    getTokens.push(token);
    return get(url);
  });

  (service as any).logger = {
    log: (m: string) => logs.push(String(m)),
    warn: (m: string) => logs.push(String(m)),
    error: (m: string) => logs.push(String(m)),
    debug: (m: string) => logs.push(String(m)),
    verbose: (m: string) => logs.push(String(m)),
  };

  return {
    service,
    getUrls,
    getTokens,
    logs,
    get oauthCalls() {
      return oauthCalls;
    },
    counts: () => ({ gets: getUrls.length, oauths: oauthCalls }),
  } as Harness;
}

// ─────────────────────────────────────────────────────────────
// 1. A broken vendor is reported as a broken vendor
// ─────────────────────────────────────────────────────────────

describe('the vendor is down — we must not blame the user document', () => {
  it('reports OAuth 502 on the GST path as temporarily unavailable', async () => {
    const h = harness({ oauth: seq(httpError(502)) });

    const result = await h.service.verifyGst('19CEWPR5040D1Z3');

    expect(result.status).toBe(false);
    expect(result.message).toBe(UNAVAILABLE);
    expect(result.message).not.toContain(LEAKED_INTERNAL_STRING);
    expect(result.message).not.toBe('GST Number is invalid');
    // No point calling the lookup without a token.
    expect(h.getUrls).toHaveLength(0);
  });

  it('reports OAuth 502 on the PAN path as temporarily unavailable', async () => {
    const h = harness({ oauth: seq(httpError(502)) });

    const result = await h.service.verifyPan('CEWPR5040D');

    expect(result.status).toBe(false);
    expect(result.message).toBe(UNAVAILABLE);
    expect(result.message).not.toContain(LEAKED_INTERNAL_STRING);
    expect(result.message).not.toBe('Pan Number is invalid');
    expect(h.getUrls).toHaveLength(0);
  });

  it('reports a 502 on the GST lookup as temporarily unavailable, with a warm token', async () => {
    const h = harness({ oauth: seq(OAUTH_OK), get: seq(httpError(502)) });

    const result = await h.service.verifyGst('19CEWPR5040D1Z3');

    expect(result.status).toBe(false);
    expect(result.message).toBe(UNAVAILABLE);
    // The token was obtained once and reused across the retries.
    expect(h.counts().oauths).toBe(1);
  });

  it('reports a 504 gateway timeout as temporarily unavailable', async () => {
    const h = harness({ get: seq(httpError(504, 'Gateway Timeout')) });

    expect((await h.service.verifyGst('19CEWPR5040D1Z3')).message).toBe(
      UNAVAILABLE,
    );
  });

  it('reports a socket error as temporarily unavailable', async () => {
    const h = harness({ get: seq(networkError('ECONNRESET')) });

    expect((await h.service.verifyGst('19CEWPR5040D1Z3')).message).toBe(
      UNAVAILABLE,
    );
  });

  it('reports a stalled-socket timeout as temporarily unavailable', async () => {
    const h = harness({ get: seq(networkError('ETIMEDOUT')) });

    expect((await h.service.verifyGst('19CEWPR5040D1Z3')).message).toBe(
      UNAVAILABLE,
    );
  });

  it('reports a vendor 502 on BOTH PAN lookups as temporarily unavailable', async () => {
    const h = harness({ get: seq(httpError(502)) });

    const result = await h.service.verifyPan('CEWPR5040D');

    expect(result.status).toBe(false);
    expect(result.message).toBe(UNAVAILABLE);
    expect(result.message).not.toBe('Pan Number is invalid');
  });

  it('never leaks the internal access-token string to a caller', async () => {
    for (const oauth of [
      seq(httpError(502)),
      seq(httpError(500)),
      seq(networkError('EAI_AGAIN')),
      seq({ error: 'invalid_grant' }),
    ]) {
      const h = harness({ oauth });
      expect(
        (await h.service.verifyGst('19CEWPR5040D1Z3')).message,
      ).not.toContain(LEAKED_INTERNAL_STRING);
      const h2 = harness({ oauth });
      expect((await h2.service.verifyPan('CEWPR5040D')).message).not.toContain(
        LEAKED_INTERNAL_STRING,
      );
    }
    // Eight full verifications, each exhausting its OAuth retries with real
    // backoff sleeps — slow by construction, not by accident.
  }, 30_000);

  it('logs the real upstream status and body even though the user sees a soft message', async () => {
    const h = harness({ get: seq(httpError(502, 'upstream connect error')) });

    await h.service.verifyGst('19CEWPR5040D1Z3');

    const joined = h.logs.join('\n');
    expect(joined).toContain('502');
    expect(joined).toContain('upstream connect error');
  });
});

// ─────────────────────────────────────────────────────────────
// 2. A genuinely bad document is still a bad document
// ─────────────────────────────────────────────────────────────

describe('the vendor answered and said no — that is still "invalid"', () => {
  it('keeps the existing wording for a GSTIN the registry does not have', async () => {
    const h = harness({ get: seq(GSTIN_MISS) });

    const result = await h.service.verifyGst('19AAAAA0000A1Z5');

    expect(result.status).toBe(false);
    expect(result.message).toBe('GST Number is invalid');
  });

  it('keeps the existing wording for a PAN neither endpoint can confirm', async () => {
    const h = harness({
      get: (url: string) =>
        url.includes('/pandetail')
          ? Promise.resolve({ error: true, data: null })
          : Promise.resolve(SEARCHPAN_EMPTY),
    });

    const result = await h.service.verifyPan('ZZZZZ9999Z');

    expect(result.status).toBe(false);
    expect(result.message).toBe('Pan Number is invalid');
  });

  it('treats a non-429 4xx as a real answer, not an outage', async () => {
    const h = harness({ get: seq(httpError(400, 'invalid gstin')) });

    const result = await h.service.verifyGst('19AAAAA0000A1Z5');

    expect(result.message).toBe('GST Number is invalid');
  });

  it('leaves "Verification service not configured" untouched', async () => {
    const unconfigured = new IdfyService({ get: () => undefined } as any);

    expect(await unconfigured.verifyGst('19CEWPR5040D1Z3')).toEqual({
      status: false,
      message: 'Verification service not configured',
      gstNumber: '19CEWPR5040D1Z3',
      verifiedDocumentType: null,
    });
    expect(await unconfigured.verifyPan('CEWPR5040D')).toEqual({
      status: false,
      message: 'Verification service not configured',
      verifiedDocumentType: null,
    });
  });
});

// ─────────────────────────────────────────────────────────────
// 2b. An error we cannot classify is still not the user's fault
// ─────────────────────────────────────────────────────────────

/**
 * "Do not retry this" and "blame the user for this" are different questions,
 * and conflating them is how the original bug worked. Only a real upstream
 * status means the vendor looked at the document and rejected it. An error
 * carrying no status at all is something we do not understand — one of our own
 * bugs, most likely — and the user's GSTIN has nothing to do with it.
 */
describe('an unrecognised error is not the user document either', () => {
  it('reports an internal exception as unavailable, not as an invalid GSTIN', async () => {
    const boom = new TypeError("Cannot read properties of undefined (reading 'data')");
    const h = harness({ get: seq(boom) });

    const result = await h.service.verifyGst('19AAAAA0000A1Z5');

    expect(result.message).toBe(UNAVAILABLE);
    expect(result.status).toBe(false);
  });

  it('does the same on the PAN path', async () => {
    const boom = new TypeError('kaboom');
    const h = harness({ get: seq(boom) });

    const result = await h.service.verifyPan('CEWPR5040D');

    expect(result.message).toBe(UNAVAILABLE);
  });

  it('still refuses to retry it — unknown is not the same as transient', async () => {
    const h = harness({ get: seq(new TypeError('kaboom')) });

    await h.service.verifyGst('19AAAAA0000A1Z5');

    expect(h.counts().gets).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Retries — the change that actually restores service
// ─────────────────────────────────────────────────────────────

describe('retrying transient vendor failures', () => {
  it('succeeds on the second attempt after a 502', async () => {
    const h = harness({ get: seq(httpError(502), GSTIN_HIT) });

    const result = await h.service.verifyGst('19CEWPR5040D1Z3');

    expect(result.status).toBe(true);
    expect(result.message).toBe('GST Number is valid');
    expect(h.counts().gets).toBe(2);
  });

  it('succeeds on the third attempt after two 502s', async () => {
    const h = harness({ get: seq(httpError(502), httpError(502), GSTIN_HIT) });

    expect((await h.service.verifyGst('19CEWPR5040D1Z3')).status).toBe(true);
    expect(h.counts().gets).toBe(3);
  });

  it('retries OAuth, which is where the vendor is failing most', async () => {
    const h = harness({
      oauth: seq(httpError(502), httpError(502), OAUTH_OK),
      get: seq(GSTIN_HIT),
    });

    expect((await h.service.verifyGst('19CEWPR5040D1Z3')).status).toBe(true);
    expect(h.counts().oauths).toBe(3);
  });

  it('retries a 429', async () => {
    const h = harness({ get: seq(httpError(429, 'rate limited'), GSTIN_HIT) });

    expect((await h.service.verifyGst('19CEWPR5040D1Z3')).status).toBe(true);
    expect(h.counts().gets).toBe(2);
  });

  it('retries a socket error', async () => {
    const h = harness({ get: seq(networkError('ECONNREFUSED'), GSTIN_HIT) });

    expect((await h.service.verifyGst('19CEWPR5040D1Z3')).status).toBe(true);
    expect(h.counts().gets).toBe(2);
  });

  it('stops at MAX_RETRIES rather than hammering the vendor', async () => {
    const h = harness({ get: seq(httpError(503)) });

    await h.service.verifyGst('19CEWPR5040D1Z3');

    expect(h.counts().gets).toBe(3);
  });

  it('does NOT retry a non-429 4xx', async () => {
    const h = harness({ get: seq(httpError(404, 'no records found')) });

    await h.service.verifyGst('19CEWPR5040D1Z3');

    expect(h.counts().gets).toBe(1);
  });

  it('does NOT retry a success', async () => {
    const h = harness({ get: seq(GSTIN_HIT) });

    await h.service.verifyGst('19CEWPR5040D1Z3');

    expect(h.counts().gets).toBe(1);
  });

  it('lets an intermittent vendor still verify a PAN when only one endpoint is down', async () => {
    // /searchpan is 502ing, /pandetail is answering — exactly what was
    // measured during the outage.
    const h = harness({
      get: (url: string) =>
        url.includes('/pandetail')
          ? Promise.resolve(PANDETAIL_VALID)
          : Promise.reject(httpError(502)),
    });

    const result = await h.service.verifyPan('CEWPR5040D');

    expect(result.status).toBe(true);
    expect(result.legalName).toBe('RISHIRAJ RATERIA');
  });
});

// ─────────────────────────────────────────────────────────────
// 4. The shared time budget
// ─────────────────────────────────────────────────────────────

describe('the shared verification budget', () => {
  afterEach(() => jest.restoreAllMocks());

  /**
   * Simulates a vendor that burns the whole per-attempt timeout every time.
   * The clock is virtual so the test is fast; the mock honours the clamped
   * deadline the service hands it, which is the contract under test.
   */
  const slowVendor = (service: IdfyService, clock: { now: number }) => {
    const advance = (budget: any) => {
      const cap = budget?.deadline ?? clock.now + 6_000;
      clock.now = Math.min(clock.now + 6_000, cap);
    };
    (service as any).makePostRequest = jest.fn(
      (_u: string, _p: any, budget: any) => {
        clock.now = Math.min(
          clock.now + 500,
          budget?.deadline ?? clock.now + 500,
        );
        return Promise.resolve(OAUTH_OK);
      },
    );
    (service as any).makeGetRequest = jest.fn(
      (_u: string, _t: string, budget: any) => {
        advance(budget);
        return Promise.reject(networkError('ETIMEDOUT'));
      },
    );
  };

  it('keeps the whole GST path inside 20s of vendor time', async () => {
    const clock = { now: 1_700_000_000_000 };
    const start = clock.now;
    jest.spyOn(Date, 'now').mockImplementation(() => clock.now);

    const h = harness({});
    slowVendor(h.service, clock);

    const result = await h.service.verifyGst('19CEWPR5040D1Z3');

    expect(result.message).toBe(UNAVAILABLE);
    expect(clock.now - start).toBeLessThanOrEqual(20_000);
  });

  it('keeps the TWO-CALL PAN path inside the same 20s — the budget is shared, not per-call', async () => {
    const clock = { now: 1_700_000_000_000 };
    const start = clock.now;
    jest.spyOn(Date, 'now').mockImplementation(() => clock.now);

    const h = harness({});
    slowVendor(h.service, clock);

    const result = await h.service.verifyPan('CEWPR5040D');

    expect(result.message).toBe(UNAVAILABLE);
    // This is the assertion that protects the buyer's 30s axios timeout.
    expect(clock.now - start).toBeLessThanOrEqual(20_000);
  });

  it('stops starting new attempts once the budget is spent', async () => {
    const clock = { now: 1_700_000_000_000 };
    jest.spyOn(Date, 'now').mockImplementation(() => clock.now);

    const h = harness({});
    slowVendor(h.service, clock);

    await h.service.verifyPan('CEWPR5040D');

    // 20s of budget at 6s an attempt cannot be more than 4 attempts.
    expect(
      ((h.service as any).makeGetRequest as jest.Mock).mock.calls.length,
    ).toBeLessThanOrEqual(4);
  });

  it('finishes a real (unmocked-clock) outage well inside the buyer 30s timeout', async () => {
    const h = harness({ get: seq(httpError(502)) });

    const began = Date.now();
    await h.service.verifyPan('CEWPR5040D');
    const elapsed = Date.now() - began;

    expect(elapsed).toBeLessThan(25_000);
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────
// 5. Token invalidation on 401/403
// ─────────────────────────────────────────────────────────────

describe('a revoked token is not reused for the next 55 minutes', () => {
  it('clears the cache, re-authenticates once and retries the lookup on a 401', async () => {
    const h = harness({
      oauth: seq(
        { access_token: 'stale-token', expires_in: 3600 },
        { access_token: 'fresh-token', expires_in: 3600 },
      ),
      get: seq(httpError(401, 'token expired'), GSTIN_HIT),
    });

    const result = await h.service.verifyGst('19CEWPR5040D1Z3');

    expect(result.status).toBe(true);
    expect(h.counts().oauths).toBe(2);
    expect(h.getTokens).toEqual(['stale-token', 'fresh-token']);
  });

  it('does the same for a 403', async () => {
    const h = harness({
      oauth: seq(
        { access_token: 'stale-token', expires_in: 3600 },
        { access_token: 'fresh-token', expires_in: 3600 },
      ),
      get: seq(httpError(403, 'forbidden'), GSTIN_HIT),
    });

    expect((await h.service.verifyGst('19CEWPR5040D1Z3')).status).toBe(true);
    expect(h.getTokens).toEqual(['stale-token', 'fresh-token']);
  });

  it('does not recurse forever when the fresh token is rejected too', async () => {
    const h = harness({
      oauth: seq({ access_token: 'tok', expires_in: 3600 }),
      get: seq(httpError(401, 'token expired')),
    });

    const result = await h.service.verifyGst('19CEWPR5040D1Z3');

    expect(result.message).toBe(UNAVAILABLE);
    // One re-auth, and exactly one retried lookup. No more.
    expect(h.counts()).toEqual({ gets: 2, oauths: 2 });
  });

  it('does not burn all three retries on a 401 before re-authenticating', async () => {
    const h = harness({
      oauth: seq({ access_token: 'tok', expires_in: 3600 }),
      get: seq(httpError(401)),
    });

    await h.service.verifyGst('19CEWPR5040D1Z3');

    expect(h.counts().gets).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────
// 6. Input normalisation
// ─────────────────────────────────────────────────────────────

describe('GSTIN and PAN normalisation', () => {
  it('strips an internal space from a GSTIN instead of sending %20 to the vendor', async () => {
    const h = harness({ get: seq(GSTIN_HIT) });

    const result = await h.service.verifyGst('19CEWPR5040D 1Z3');

    expect(h.getUrls[0]).toContain('gstin=19CEWPR5040D1Z3');
    expect(h.getUrls[0]).not.toContain('%20');
    expect(h.getUrls[0]).not.toContain(' ');
    expect(result.status).toBe(true);
  });

  it('trims and upper-cases a GSTIN', async () => {
    const h = harness({ get: seq(GSTIN_HIT) });

    await h.service.verifyGst('  19cewpr5040d1z3  ');

    expect(h.getUrls[0]).toContain('gstin=19CEWPR5040D1Z3');
  });

  it('reports the normalised GSTIN back, not the messy input', async () => {
    const h = harness({ get: seq(GSTIN_HIT) });

    const result = await h.service.verifyGst('19cewpr5040d 1z3');

    expect(result.gstNumber).toBe('19CEWPR5040D1Z3');
  });

  it('strips internal whitespace from a PAN too', async () => {
    const h = harness({ get: seq(SEARCHPAN_HIT) });

    await h.service.verifyPan(' cewpr 5040d ');

    expect(h.getUrls[0]).toContain('pan=CEWPR5040D');
  });
});

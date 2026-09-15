import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import { IdfyVerificationResponseDto } from './dto/idfy-pan.dto';
import { IdfyGstVerificationResponseDto } from './dto/idfy-gst.dto';

interface MastersIndiaConfig {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  oauthUrl: string;
  apiBaseUrl: string;
}

const MAX_RETRIES = 3;

/**
 * Total wall-clock allowed for ONE verifyGst/verifyPan call, covering OAuth,
 * every lookup and every backoff sleep.
 *
 * This is a single shared budget rather than a per-call timeout on purpose.
 * The PAN path makes two sequential vendor calls and each can be retried up to
 * MAX_RETRIES times; naive per-call timeouts would let a bad day add up to
 * roughly a minute. The buyer's axios client gives up at 30s, so anything over
 * that stops being a message the user can read and becomes "Network error.
 * Please check your connection." — which is what happened during the outage.
 */
const VERIFICATION_BUDGET_MS = 20_000;

/** Ceiling for a single HTTP attempt. Always clamped to the budget left. */
const ATTEMPT_TIMEOUT_MS = 6_000;

/** Below this there is no point starting another attempt or sleeping. */
const MIN_USEFUL_ATTEMPT_MS = 750;

/** Backoff before attempt 2 and attempt 3. Jittered, and budget-clamped. */
const BACKOFF_MS = [250, 750];

/**
 * What a user is told when the vendor — not their document — is the problem.
 * Both frontends render `message` verbatim in a toast, so this string IS the
 * user-facing copy.
 */
const SERVICE_UNAVAILABLE_MESSAGE =
  'Verification service is temporarily unavailable. Please try again in a few minutes.';

/** An absolute deadline, threaded through everything one request touches. */
interface Budget {
  readonly deadline: number;
}

const startBudget = (): Budget => ({
  deadline: Date.now() + VERIFICATION_BUDGET_MS,
});

const msLeft = (budget: Budget): number => budget.deadline - Date.now();

/** Per-attempt socket timeout, never allowed to outlive the shared budget. */
const attemptTimeoutMs = (budget?: Budget): number =>
  budget
    ? Math.max(1, Math.min(ATTEMPT_TIMEOUT_MS, msLeft(budget)))
    : ATTEMPT_TIMEOUT_MS;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** The vendor answered, but not with a 2xx. Carries the real cause. */
class VendorHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly responseBody: string,
    message: string,
  ) {
    super(message);
    this.name = 'VendorHttpError';
  }
}

/** The socket stalled. Distinguishable so the retry layer can act on it. */
class VendorTimeoutError extends Error {
  readonly code = 'ETIMEDOUT';

  constructor(message: string) {
    super(message);
    this.name = 'VendorTimeoutError';
  }
}

/** The vendor returned 2xx but the body was not usable JSON. */
class VendorBadResponseError extends Error {
  readonly code = 'EBADRESPONSE';

  constructor(
    message: string,
    readonly responseBody: string,
  ) {
    super(message);
    this.name = 'VendorBadResponseError';
  }
}

/** We could not even get far enough to ask. Never shown to a user. */
class VendorUnavailableError extends Error {
  readonly code = 'EVENDORUNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'VendorUnavailableError';
  }
}

/** Socket/DNS level failures that are worth another go. */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EPROTO',
  'ERR_STREAM_PREMATURE_CLOSE',
  'EBADRESPONSE',
  'EVENDORUNAVAILABLE',
]);

type FailureKind = 'transient' | 'auth' | 'permanent';

/**
 * The upstream status, from the structured error where we have one and from
 * the message otherwise (the transport has always formatted it in).
 */
function httpStatusOf(err: any): number | null {
  if (typeof err?.statusCode === 'number') return err.statusCode;
  const matched = /HTTP\s+(\d{3})/i.exec(String(err?.message ?? ''));
  return matched ? Number(matched[1]) : null;
}

function upstreamBodyOf(err: any): string {
  const body = err?.responseBody;
  return typeof body === 'string' && body ? body.slice(0, 200) : 'n/a';
}

/**
 * 'transient' is retryable and means "the vendor is broken".
 * 'auth'      means the token was rejected — re-authenticate, do not retry.
 * 'permanent' means the vendor gave us a real answer: the document is bad.
 *
 * Unrecognised errors are deliberately 'permanent'. Retrying something we do
 * not understand would spend the user's budget for nothing.
 */
function classifyFailure(err: any): FailureKind {
  const status = httpStatusOf(err);
  if (status !== null) {
    if (status === 401 || status === 403) return 'auth';
    if (status === 429 || status >= 500) return 'transient';
    return 'permanent';
  }
  const code = typeof err?.code === 'string' ? err.code : '';
  return TRANSIENT_NETWORK_CODES.has(code) ? 'transient' : 'permanent';
}

/**
 * A failure the user must not be blamed for.
 *
 * Retryability and blame are NOT the same question. A 'permanent' failure is
 * one we will not retry, but only a real upstream status means the vendor
 * actually looked at the document and rejected it. A 'permanent' classification
 * with no status at all is an error we simply do not understand — a bug of our
 * own, say — and telling a seller their GSTIN is invalid because our own code
 * threw is the precise failure this whole change exists to stop.
 */
const isVendorFault = (err: any): boolean =>
  classifyFailure(err) !== 'permanent' || httpStatusOf(err) === null;

function describeFailure(err: any): string {
  return [
    `upstreamStatus=${httpStatusOf(err) ?? 'n/a'}`,
    `code=${err?.code ?? 'n/a'}`,
    `body=${upstreamBodyOf(err)}`,
    `message=${err?.message ?? String(err)}`,
  ].join(' ');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Trim, upper-case and strip INTERNAL whitespace.
 *
 * verifyGst used to interpolate its argument into the URL untouched, so a
 * GSTIN pasted with a space became %20, the vendor found no such registration,
 * and a seller with a perfectly good GSTIN was told it was invalid.
 */
function normaliseDocumentNumber(value: string): string {
  return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

/**
 * PAN is personally identifiable and these logs are shipped off the box. The
 * last four characters are enough to match a request to a support report.
 *
 * GSTINs get the same treatment: a GSTIN has the holder's PAN embedded in
 * characters 3-12, so logging one in full leaks a PAN.
 */
function maskDocumentNumber(value: string): string {
  return value.length > 4
    ? `${'*'.repeat(value.length - 4)}${value.slice(-4)}`
    : '****';
}

/**
 * Lookup result that keeps "the vendor broke" apart from "the vendor answered
 * and has no such record". Collapsing both to null is what let a 502 be
 * reported to a user as an invalid document.
 */
type LookupOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'not-found' }
  | { kind: 'unavailable' };

@Injectable()
export class IdfyService {
  private readonly logger = new Logger(IdfyService.name);
  private readonly config: MastersIndiaConfig | null;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(private readonly configService: ConfigService) {
    const clientId = this.configService.get<string>('MASTERS_INDIA_CLIENT_ID');
    const clientSecret = this.configService.get<string>('MASTERS_INDIA_CLIENT_SECRET');
    const username = this.configService.get<string>('MASTERS_INDIA_USERNAME');
    const password = this.configService.get<string>('MASTERS_INDIA_PASSWORD');

    if (clientId && clientSecret && username && password) {
      this.config = {
        clientId,
        clientSecret,
        username,
        password,
        oauthUrl: 'https://commonapi.mastersindia.co/oauth/access_token',
        apiBaseUrl: 'https://commonapi.mastersindia.co/commonapis',
      };
      this.logger.log('Masters India service initialized (credentials configured)');
    } else {
      this.config = null;
      this.logger.warn(
        'Masters India service NOT configured — Missing credentials. Verification will be skipped.',
      );
    }
  }

  /** Returns true when Masters India credentials are present */
  isConfigured(): boolean {
    return this.config !== null;
  }

  // ─────────────────────────────────────────────────
  // PAN VERIFICATION
  // ─────────────────────────────────────────────────

  /**
   * Verify a PAN.
   *
   * Two different Masters India endpoints are involved, and confusing them is
   * what broke this:
   *
   *   /searchpan  — "Search by PAN". Returns the GSTINs registered against the
   *                 PAN. A PAN with no GST registration has no rows, so this
   *                 answers "nothing found" for a perfectly valid PAN.
   *   /pandetail  — "PAN Details". The actual PAN check: holder name, entity
   *                 type and PAN status, straight from the PAN database, with
   *                 no GST involvement at all.
   *
   * Only the first was ever called, which is why an individual or a business
   * without GST registration could not complete onboarding.
   *
   * The GST-registry lookup still runs FIRST and is untouched, so every PAN
   * that verifies today keeps verifying, with the same legal name (the GST
   * legal name, which is the better business name when one exists) and the
   * same linked GSTIN. The PAN check is only reached when that finds nothing.
   *
   * Both lookups share ONE budget: two sequential calls, each retryable, must
   * still finish inside the buyer's 30s client timeout.
   */
  async verifyPan(panNumber: string): Promise<IdfyVerificationResponseDto> {
    if (!this.config) {
      return {
        status: false,
        message: 'Verification service not configured',
        verifiedDocumentType: null
      };
    }

    const pan = normaliseDocumentNumber(panNumber);
    const budget = startBudget();

    try {
      // Step 1: Get/refresh access token. A vendor that cannot even issue a
      // token is a vendor outage, not a bad PAN.
      const accessToken = await this.getAccessToken(budget);
      if (!accessToken) {
        this.logger.error(
          `PAN verification for ${maskDocumentNumber(pan)} aborted: no Masters India access token (see the OAuth failure above). Reporting the vendor as unavailable.`,
        );
        return this.panUnavailable();
      }

      // Step 2: GST registry lookup — unchanged, and still first.
      const viaGstRegistry = await this.lookupPanInGstRegistry(pan, budget);
      if (viaGstRegistry.kind === 'ok') return viaGstRegistry.value;

      // Step 3: The PAN itself. Reached when the PAN carries no GST
      // registration, which used to be reported as an invalid PAN. Still worth
      // trying when step 2 broke: the outage was intermittent per-endpoint.
      const viaPanRecord = await this.lookupPanRecord(pan, budget);
      if (viaPanRecord.kind === 'ok') return viaPanRecord.value;

      // Neither confirmed it. Only call the PAN bad if BOTH endpoints actually
      // answered — otherwise we are guessing on the user's behalf.
      if (
        viaGstRegistry.kind === 'unavailable' ||
        viaPanRecord.kind === 'unavailable'
      ) {
        this.logger.error(
          `PAN verification for ${maskDocumentNumber(pan)} could not be completed: at least one Masters India lookup failed. Reporting unavailable rather than invalid.`,
        );
        return this.panUnavailable();
      }

      return {
        status: false,
        message: 'Pan Number is invalid',
        verifiedDocumentType: null
      };
    } catch (err: any) {
      // Nothing below should throw; if it does it is our bug, not a bad PAN.
      this.logger.error(
        `PAN verification for ${maskDocumentNumber(pan)} failed unexpectedly: ${describeFailure(err)}`,
      );
      return this.panUnavailable();
    }
  }

  /**
   * GSTINs registered against this PAN.
   *
   * 'not-found' means the vendor answered and has nothing. 'unavailable' means
   * the vendor broke. Keeping those apart is the whole fix — a 502 here used
   * to be indistinguishable from an unregistered PAN.
   *
   * Still swallows its own failure so that one endpoint being down cannot stop
   * the other from answering.
   */
  private async lookupPanInGstRegistry(
    pan: string,
    budget: Budget,
  ): Promise<LookupOutcome<IdfyVerificationResponseDto>> {
    const url = `${this.config!.apiBaseUrl}/searchpan?pan=${encodeURIComponent(pan)}`;
    const label = `PAN-to-GST lookup ${maskDocumentNumber(pan)}`;

    try {
      this.logger.log(`Calling PAN-to-GST API for ${maskDocumentNumber(pan)}`);
      const response = await this.authorizedGet(url, budget, label);
      const parsed = this.parsePanResponse(response, pan);
      return parsed.status ? { kind: 'ok', value: parsed } : { kind: 'not-found' };
    } catch (err: any) {
      if (isVendorFault(err)) {
        this.logger.error(`${label} UNAVAILABLE: ${describeFailure(err)}`);
        return { kind: 'unavailable' };
      }
      // A PAN with no GST registration can also come back as a 4xx here.
      this.logger.log(`${label} found nothing: ${describeFailure(err)}`);
      return { kind: 'not-found' };
    }
  }

  /** The PAN record itself — no GST registration required. */
  private async lookupPanRecord(
    pan: string,
    budget: Budget,
  ): Promise<LookupOutcome<IdfyVerificationResponseDto>> {
    const url = `${this.config!.apiBaseUrl}/pandetail?pan=${encodeURIComponent(pan)}`;
    const label = `PAN details lookup ${maskDocumentNumber(pan)}`;

    try {
      this.logger.log(`Calling PAN details API for ${maskDocumentNumber(pan)}`);
      const response = await this.authorizedGet(url, budget, label);
      const parsed = this.parsePanDetailResponse(response);
      return parsed ? { kind: 'ok', value: parsed } : { kind: 'not-found' };
    } catch (err: any) {
      if (isVendorFault(err)) {
        this.logger.error(`${label} UNAVAILABLE: ${describeFailure(err)}`);
        return { kind: 'unavailable' };
      }
      this.logger.log(`${label} found nothing: ${describeFailure(err)}`);
      return { kind: 'not-found' };
    }
  }

  private panUnavailable(): IdfyVerificationResponseDto {
    return {
      status: false,
      message: SERVICE_UNAVAILABLE_MESSAGE,
      verifiedDocumentType: null,
    };
  }

  // ─────────────────────────────────────────────────
  // GST VERIFICATION
  // ─────────────────────────────────────────────────

  async verifyGst(
    gstNumber: string,
  ): Promise<IdfyGstVerificationResponseDto> {
    const gstin = normaliseDocumentNumber(gstNumber);

    if (!this.config) {
      return {
        status: false,
        message: 'Verification service not configured',
        gstNumber: gstin,
        verifiedDocumentType: null,
      };
    }

    const budget = startBudget();
    const label = `GST lookup ${maskDocumentNumber(gstin)}`;

    try {
      const accessToken = await this.getAccessToken(budget);
      if (!accessToken) {
        this.logger.error(
          `${label} aborted: no Masters India access token (see the OAuth failure above). Reporting the vendor as unavailable.`,
        );
        return this.gstUnavailable(gstin);
      }

      // Functional GST search API for Masters India
      const url = `${this.config.apiBaseUrl}/searchgstin?gstin=${encodeURIComponent(gstin)}`;
      this.logger.log(`Calling GST API for ${maskDocumentNumber(gstin)}`);
      const response = await this.authorizedGet(url, budget, label);
      this.logger.log(
        `GST API response for ${maskDocumentNumber(gstin)}: ${safeJson(response)}`,
      );
      return this.parseGstResponse(response, gstin);
    } catch (err: any) {
      if (isVendorFault(err)) {
        this.logger.error(`${label} UNAVAILABLE: ${describeFailure(err)}`);
        return this.gstUnavailable(gstin);
      }
      // The vendor really answered and rejected it.
      this.logger.error(`${label} rejected by the registry: ${describeFailure(err)}`);
      return {
        status: false,
        message: 'GST Number is invalid',
        gstNumber: gstin,
        verifiedDocumentType: null,
      };
    }
  }

  private gstUnavailable(gstNumber: string): IdfyGstVerificationResponseDto {
    return {
      status: false,
      message: SERVICE_UNAVAILABLE_MESSAGE,
      gstNumber,
      verifiedDocumentType: null,
    };
  }

  // ─────────────────────────────────────────────────
  // OAUTH: GET/REFRESH ACCESS TOKEN
  // ─────────────────────────────────────────────────

  private async getAccessToken(budget: Budget): Promise<string | null> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    try {
      const payload = {
        username: this.config!.username,
        password: this.config!.password,
        client_id: this.config!.clientId,
        client_secret: this.config!.clientSecret,
        grant_type: 'password',

      };

      this.logger.log('Requesting OAuth access token from Masters India...');
      const response = await this.withRetry('Masters India OAuth', budget, (b) =>
        this.makePostRequest(this.config!.oauthUrl, payload, b),
      );

      if (response?.access_token) {
        this.accessToken = response.access_token;
        const expiresIn = (response.expires_in || 3600) - 300;
        this.tokenExpiresAt = Date.now() + expiresIn * 1000;
        this.logger.log('Successfully obtained new OAuth token from Masters India');
        return this.accessToken;
      }

      this.logger.error(
        `OAuth Success but no token found in response. Status: ${response?.error ? 'Error' : 'OK'
        }, Body: ${safeJson(response)}`,
      );
      return null;
    } catch (err: any) {
      this.logger.error(
        `Masters India OAuth request failed after retries: ${describeFailure(err)}`,
      );
      return null;
    }
  }

  /** Drop the cached token so the next caller re-authenticates. */
  private invalidateAccessToken(): void {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * An authenticated GET with retries. If the vendor rejects our token with a
   * 401/403 the cache is dropped and the lookup is retried exactly once with a
   * fresh token — `mayReauthenticate` is the recursion guard.
   *
   * Without this a revoked token stayed cached for up to ~55 minutes.
   */
  private async authorizedGet(
    url: string,
    budget: Budget,
    label: string,
    mayReauthenticate = true,
  ): Promise<any> {
    const accessToken = await this.getAccessToken(budget);
    if (!accessToken) {
      // Internal only. The user gets SERVICE_UNAVAILABLE_MESSAGE.
      throw new VendorUnavailableError(
        'Failed to obtain access token from Masters India',
      );
    }

    try {
      return await this.withRetry(label, budget, (b) =>
        this.makeGetRequest(url, accessToken, b),
      );
    } catch (err: any) {
      if (mayReauthenticate && classifyFailure(err) === 'auth') {
        this.logger.warn(
          `${label}: Masters India rejected the cached token (HTTP ${httpStatusOf(err)}). Clearing it and re-authenticating once.`,
        );
        this.invalidateAccessToken();
        return this.authorizedGet(url, budget, `${label} (after re-auth)`, false);
      }
      throw err;
    }
  }

  /**
   * Runs an attempt up to MAX_RETRIES times, but only re-attempts genuinely
   * transient failures, and only while the shared budget allows it.
   *
   * A 2xx is never retried. A non-429 4xx is never retried: a real "GSTIN not
   * found" must fail immediately and stay a real "invalid" answer. A 401/403
   * is not retried either — it is handed straight back so the caller can
   * re-authenticate instead of burning attempts on a token we know is bad.
   */
  private async withRetry<T>(
    label: string,
    budget: Budget,
    attempt: (budget: Budget) => Promise<T>,
  ): Promise<T> {
    let lastError: any = null;

    for (let n = 1; n <= MAX_RETRIES; n++) {
      const left = msLeft(budget);
      if (left < MIN_USEFUL_ATTEMPT_MS) {
        this.logger.warn(
          `${label}: verification budget exhausted (${left}ms left) before attempt ${n}/${MAX_RETRIES}`,
        );
        break;
      }

      try {
        return await attempt(budget);
      } catch (err: any) {
        lastError = err;
        const kind = classifyFailure(err);
        this.logger.error(
          `${label}: attempt ${n}/${MAX_RETRIES} failed [${kind}] ${describeFailure(err)}`,
        );

        if (kind !== 'transient') throw err;
        if (n === MAX_RETRIES) break;

        const base = BACKOFF_MS[n - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
        const jittered = Math.round(base * (0.75 + Math.random() * 0.5));
        const backoff = Math.min(jittered, msLeft(budget) - MIN_USEFUL_ATTEMPT_MS);
        if (backoff <= 0) {
          this.logger.warn(
            `${label}: no budget left to back off; giving up after ${n} attempt(s)`,
          );
          break;
        }
        await sleep(backoff);
      }
    }

    throw (
      lastError ??
      new VendorUnavailableError(`${label}: no attempt could be made in budget`)
    );
  }

  // ─────────────────────────────────────────────────
  // HTTP REQUESTS
  // ─────────────────────────────────────────────────

  private makePostRequest(
    url: string,
    payload: Record<string, any>,
    budget?: Budget,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      const parsedUrl = new URL(url);
      const timeout = attemptTimeoutMs(budget);

      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'PharmaBag/1.0.1',
          'Accept': 'application/json',
          'client_id': this.config?.clientId || '',
        },
        timeout,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            return reject(
              new VendorHttpError(
                res.statusCode,
                raw.slice(0, 200),
                `Masters India API HTTP ${res.statusCode}: ${raw.slice(0, 200)}`,
              ),
            );
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(
              new VendorBadResponseError(
                `Failed to parse response: ${raw.slice(0, 200)}`,
                raw.slice(0, 200),
              ),
            );
          }
        });
      });

      // Node emits 'timeout' but does NOT abort. Without this the socket
      // stalls forever and the caller's own client times out first.
      req.on('timeout', () => {
        req.destroy(
          new VendorTimeoutError(
            `Masters India OAuth request timed out after ${timeout}ms`,
          ),
        );
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private makeGetRequest(
    url: string,
    accessToken: string,
    budget?: Budget,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const timeout = attemptTimeoutMs(budget);

      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'client_id': this.config!.clientId,
          'User-Agent': 'PharmaBag/1.0.0',
          'Accept': 'application/json',
        },
        timeout,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            return reject(
              new VendorHttpError(
                res.statusCode,
                raw.slice(0, 200),
                `Masters India API HTTP ${res.statusCode}: ${raw.slice(0, 200)}`,
              ),
            );
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(
              new VendorBadResponseError(
                `Failed to parse response: ${raw.slice(0, 200)}`,
                raw.slice(0, 200),
              ),
            );
          }
        });
      });

      // See makePostRequest: 'timeout' alone does not abort the request.
      req.on('timeout', () => {
        req.destroy(
          new VendorTimeoutError(
            `Masters India API request timed out after ${timeout}ms`,
          ),
        );
      });
      req.on('error', reject);
      req.end();
    });
  }

  // ─────────────────────────────────────────────────
  // RESPONSE PARSERS
  // ─────────────────────────────────────────────────

  private parsePanResponse(
    response: any,
    panNumber: string,
  ): IdfyVerificationResponseDto {
    if (!response || response.error === true || !Array.isArray(response.data) || response.data.length === 0) {
      return { status: false, message: 'Pan Number is invalid', verifiedDocumentType: null };
    }

    const data = response.data[0];
    const legalName = data.lgnm ?? data.name ?? data.legal_name ?? data.fullName ?? 'N/A';
    const gstNumber = data.gstin || null;

    return {
      status: true,
      legalName,
      gstNumber: gstNumber || undefined,
      message: 'Pan Number is valid',
      verifiedDocumentType: 'ind_pan',
    };
  }

  /**
   * Reads the /pandetail payload:
   *
   *   { error: false, data: { status: {...}, response: {
   *       number, name, typeOfHolder, isIndividual, isValid,
   *       firstName, middleName, lastName, title, panStatusCode, panStatus, ...
   *   } } }
   *
   * Returns null rather than a failure object so the caller can tell "this
   * endpoint could not confirm it" from "this PAN is bad".
   *
   * A PAN is accepted only when the provider says it is valid. A record that
   * exists but reads INVALID or DEACTIVATED is not a pass.
   */
  private parsePanDetailResponse(
    response: any,
  ): IdfyVerificationResponseDto | null {
    if (!response || response.error === true) return null;

    const record = response.data?.response ?? response.response ?? response.data;
    if (!record || typeof record !== 'object') return null;

    const statusText = String(record.panStatus ?? '').toUpperCase();
    const isValid =
      record.isValid === true ||
      statusText === 'VALID' ||
      statusText === 'EXISTING AND VALID';

    if (!isValid) return null;

    const assembled = [record.firstName, record.middleName, record.lastName]
      .filter((part: unknown) => typeof part === 'string' && part.trim())
      .join(' ')
      .trim();

    const legalName =
      (typeof record.name === 'string' && record.name.trim()) ||
      assembled ||
      record.fullName ||
      'N/A';

    return {
      status: true,
      legalName,
      // Deliberately absent: this PAN has no GST registration behind it, and
      // sending an empty string would put one in the buyer's GST field.
      message: 'Pan Number is valid',
      verifiedDocumentType: 'ind_pan',
    };
  }

  private parseGstResponse(
    response: any,
    gstNumber: string,
  ): IdfyGstVerificationResponseDto {
    if (!response || response.error === true || !response.data) {
      return {
        status: false,
        message: 'GST Number is invalid',
        gstNumber,
        verifiedDocumentType: null
      };
    }

    // Handle both array and object responses from Masters India API
    let data;
    if (Array.isArray(response.data)) {
      if (response.data.length === 0) {
        return {
          status: false,
          message: 'GST Number is invalid',
          gstNumber,
          verifiedDocumentType: null
        };
      }
      data = response.data[0];
    } else {
      data = response.data;
    }

    const legalName = data.tradeNam ?? data.lgnm ?? data.name ?? data.legal_name ?? 'N/A';

    // Masters India uses either 'nature_of_business_activity' or 'nba' (array)
    let businessActivity = 'N/A';
    if (data.nature_of_business_activity) {
      businessActivity = data.nature_of_business_activity;
    } else if (Array.isArray(data.nba) && data.nba.length > 0) {
      businessActivity = data.nba.join(', ');
    }

    // Masters India uses either 'principal_place_of_business_address', 'address', or 'pradr.addr'
    let address = 'N/A';
    if (data.principal_place_of_business_address) {
      address = data.principal_place_of_business_address;
    } else if (data.address) {
      address = data.address;
    } else if (data.pradr && data.pradr.addr) {
      const addrObj = data.pradr.addr;
      // Build a string from the nested address fields (bnm, st, loc, city, dst, stcd, pncd)
      const parts = [addrObj.bno, addrObj.bnm, addrObj.flno, addrObj.st, addrObj.loc, addrObj.city, addrObj.dst, addrObj.stcd, addrObj.pncd]
        .filter(p => p && p.trim() !== '');
      address = parts.join(', ');
    }

    return {
      status: true,
      legalName,
      gstNumber,
      natureOfBusinessActivity: businessActivity,
      address,
      message: 'GST Number is valid',
      verifiedDocumentType: 'ind_gst_certificate',
    };
  }
}

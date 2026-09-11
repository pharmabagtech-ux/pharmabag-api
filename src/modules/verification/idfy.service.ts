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
const TIMEOUT_MS = 10_000;

/**
 * PAN is personally identifiable and these logs are shipped off the box. The
 * last four characters are enough to match a request to a support report.
 */
function maskPan(pan: string): string {
  return pan.length > 4 ? `${'*'.repeat(pan.length - 4)}${pan.slice(-4)}` : '****';
}

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
   */
  async verifyPan(panNumber: string): Promise<IdfyVerificationResponseDto> {
    if (!this.config) {
      return {
        status: false,
        message: 'Verification service not configured',
        verifiedDocumentType: null
      };
    }

    const pan = (panNumber ?? '').trim().toUpperCase();

    try {
      // Step 1: Get/refresh access token
      const accessToken = await this.getAccessToken();
      if (!accessToken) {
        return {
          status: false,
          message: 'Failed to obtain access token',
          verifiedDocumentType: null
        };
      }

      // Step 2: GST registry lookup — unchanged, and still first.
      const viaGstRegistry = await this.lookupPanInGstRegistry(pan, accessToken);
      if (viaGstRegistry) return viaGstRegistry;

      // Step 3: The PAN itself. Reached when the PAN carries no GST
      // registration, which used to be reported as an invalid PAN.
      const viaPanRecord = await this.lookupPanRecord(pan, accessToken);
      if (viaPanRecord) return viaPanRecord;

      return {
        status: false,
        message: 'Pan Number is invalid',
        verifiedDocumentType: null
      };
    } catch (err: any) {
      this.logger.error(`PAN verification failed: ${err.message}`);
      return {
        status: false,
        message: 'Pan Number is invalid',
        verifiedDocumentType: null
      };
    }
  }

  /**
   * GSTINs registered against this PAN. Null means "found nothing", which is
   * not the same as "the PAN is bad" — that distinction is the whole fix.
   *
   * Swallows its own failure so that one endpoint being down or rejecting a
   * request cannot stop the other from answering.
   */
  private async lookupPanInGstRegistry(
    pan: string,
    accessToken: string,
  ): Promise<IdfyVerificationResponseDto | null> {
    try {
      const url = `${this.config!.apiBaseUrl}/searchpan?pan=${pan}`;
      this.logger.log(`Calling PAN-to-GST API for ${maskPan(pan)}`);
      const response = await this.makeGetRequest(url, accessToken);
      const parsed = this.parsePanResponse(response, pan);
      return parsed.status ? parsed : null;
    } catch (err: any) {
      // A PAN with no GST registration can also come back as a 4xx here.
      this.logger.log(
        `PAN-to-GST lookup found nothing for ${maskPan(pan)}: ${err.message}`,
      );
      return null;
    }
  }

  /** The PAN record itself — no GST registration required. */
  private async lookupPanRecord(
    pan: string,
    accessToken: string,
  ): Promise<IdfyVerificationResponseDto | null> {
    try {
      const url = `${this.config!.apiBaseUrl}/pandetail?pan=${pan}`;
      this.logger.log(`Calling PAN details API for ${maskPan(pan)}`);
      const response = await this.makeGetRequest(url, accessToken);
      return this.parsePanDetailResponse(response);
    } catch (err: any) {
      this.logger.error(
        `PAN details lookup failed for ${maskPan(pan)}: ${err.message}`,
      );
      return null;
    }
  }

  // ─────────────────────────────────────────────────
  // GST VERIFICATION
  // ─────────────────────────────────────────────────

  async verifyGst(
    gstNumber: string,
  ): Promise<IdfyGstVerificationResponseDto> {
    if (!this.config) {
      return {
        status: false,
        message: 'Verification service not configured',
        gstNumber,
        verifiedDocumentType: null,
      };
    }

    try {
      const accessToken = await this.getAccessToken();
      if (!accessToken) {
        return {
          status: false,
          message: 'Failed to obtain access token',
          gstNumber,
          verifiedDocumentType: null,
        };
      }

      // Functional GST search API for Masters India
      const url = `${this.config.apiBaseUrl}/searchgstin?gstin=${gstNumber}`;
      this.logger.log(`Calling GST API: ${url}`);
      const response = await this.makeGetRequest(url, accessToken);
      this.logger.log(`GST API Response: ${JSON.stringify(response)}`);
      return this.parseGstResponse(response, gstNumber);
    } catch (err: any) {
      this.logger.error(`GST verification failed: ${err.message}`);
      return {
        status: false,
        message: 'GST Number is invalid',
        gstNumber,
        verifiedDocumentType: null,
      };
    }
  }

  // ─────────────────────────────────────────────────
  // OAUTH: GET/REFRESH ACCESS TOKEN
  // ─────────────────────────────────────────────────

  private async getAccessToken(): Promise<string | null> {
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
      const response = await this.makePostRequest(this.config!.oauthUrl, payload);

      if (response.access_token) {
        this.accessToken = response.access_token;
        const expiresIn = (response.expires_in || 3600) - 300;
        this.tokenExpiresAt = Date.now() + expiresIn * 1000;
        this.logger.log('Successfully obtained new OAuth token from Masters India');
        return this.accessToken;
      }

      this.logger.error(
        `OAuth Success but no token found in response. Status: ${response.error ? 'Error' : 'OK'
        }, Body: ${JSON.stringify(response)}`,
      );
      return null;
    } catch (err: any) {
      this.logger.error(`Masters India OAuth request failed: ${err.message}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────────
  // HTTP REQUESTS
  // ─────────────────────────────────────────────────

  private makePostRequest(
    url: string,
    payload: Record<string, any>,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      const parsedUrl = new URL(url);

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
        timeout: TIMEOUT_MS,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            return reject(new Error(`Masters India API HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(`Failed to parse response: ${raw.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private makeGetRequest(
    url: string,
    accessToken: string,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);

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
        timeout: TIMEOUT_MS,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            return reject(new Error(`Masters India API HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(`Failed to parse response: ${raw.slice(0, 200)}`));
          }
        });
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

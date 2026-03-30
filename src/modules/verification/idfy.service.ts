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

  async verifyPan(panNumber: string): Promise<IdfyVerificationResponseDto> {
    if (!this.config) {
      return { status: false, message: 'Verification service not configured' };
    }

    try {
      // Step 1: Get/refresh access token
      const accessToken = await this.getAccessToken();
      if (!accessToken) {
        return { status: false, message: 'Failed to obtain access token' };
      }

      // Step 2: Call PAN search API
      const url = `${this.config.apiBaseUrl}/searchpan?pan=${panNumber}`;
      this.logger.log(`Calling PAN API: ${url}`);
      const response = await this.makeGetRequest(url, accessToken);
      this.logger.log(`PAN API Response: ${JSON.stringify(response)}`);
      return this.parsePanResponse(response, panNumber);
    } catch (err: any) {
      this.logger.error(`PAN verification failed: ${err.message}`);
      return { status: false, message: 'Pan Number is invalid' };
    }
  }

  // ─────────────────────────────────────────────────
  // GST VERIFICATION (Not supported by Masters India)
  // ─────────────────────────────────────────────────

  async verifyGst(
    gstNumber: string,
  ): Promise<IdfyGstVerificationResponseDto> {
    this.logger.warn('GST verification not supported by Masters India API');
    return {
      status: false,
      message: 'GST verification not currently available',
      gstNumber,
    };
  }

  // ─────────────────────────────────────────────────
  // OAUTH: GET/REFRESH ACCESS TOKEN
  // ─────────────────────────────────────────────────

  private async getAccessToken(): Promise<string | null> {
    // Return cached token if still valid
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      this.logger.log('Using cached access token');
      return this.accessToken;
    }

    try {
      const payload = {
        client_id: this.config!.clientId,
        client_secret: this.config!.clientSecret,
        grant_type: 'password',
        username: this.config!.username,
        password: this.config!.password,
      };

      this.logger.log('Requesting OAuth access token...');
      const response = await this.makePostRequest(this.config!.oauthUrl, payload);
      this.logger.log(`OAuth Response: ${JSON.stringify(response)}`);

      if (response.access_token) {
        this.accessToken = response.access_token;
        // Expire token 5 minutes before actual expiry for safety
        const expiresIn = (response.expires_in || 3600) - 300;
        this.tokenExpiresAt = Date.now() + expiresIn * 1000;
        this.logger.log('Access token obtained successfully');
        return this.accessToken;
      }

      this.logger.error(`No access token in OAuth response: ${JSON.stringify(response)}`);
      return null;
    } catch (err: any) {
      this.logger.error(`OAuth request failed: ${err.message}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────────
  // HTTP REQUESTS (POST for OAuth, GET for API)
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
        },
        timeout: TIMEOUT_MS,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');

          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            return reject(
              new Error(`Masters India API HTTP ${res.statusCode}: ${raw.slice(0, 200)}`),
            );
          }

          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(`Failed to parse response: ${raw.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out after ${TIMEOUT_MS}ms`));
      });

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
        },
        timeout: TIMEOUT_MS,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');

          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            return reject(
              new Error(`Masters India API HTTP ${res.statusCode}: ${raw.slice(0, 200)}`),
            );
          }

          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(`Failed to parse response: ${raw.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out after ${TIMEOUT_MS}ms`));
      });

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
    this.logger.log(`Parsing PAN response: ${JSON.stringify(response)}`);
    console.log(`[IDFY] Parsing PAN response:`, response);

    if (!response) {
      this.logger.warn('Empty response from PAN API');
      return {
        status: false,
        message: 'Pan Number is invalid',
      } as IdfyVerificationResponseDto;
    }

    // Check if API returned error flag
    if (response.error === true) {
      this.logger.warn(`API returned error: ${response.message || 'Unknown error'}`);
      return {
        status: false,
        message: 'Pan Number is invalid',
      } as IdfyVerificationResponseDto;
    }

    // Masters India returns data as an array
    let dataArray = response.data;
    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      this.logger.warn(`Invalid data structure in response: ${JSON.stringify(response)}`);
      return {
        status: false,
        message: 'Pan Number is invalid',
      } as IdfyVerificationResponseDto;
    }

    // Get first record from array
    const data = dataArray[0];

    // Extract legal name from Masters India field names
    // lgnm = legal name, tradeNam = trade name
    const legalName = 
      data.lgnm ?? 
      data.name ?? 
      data.legal_name ?? 
      data.fullName ?? 
      '';

    if (!legalName) {
      this.logger.warn(`No legal name found in response data: ${JSON.stringify(data)}`);
      return {
        status: false,
        message: 'Pan Number is invalid',
      } as IdfyVerificationResponseDto;
    }

    // Get GST number if available (may be empty for PAN not linked to GST)
    // If no GST linked, we still return the PAN as verified
    const gstNumber = data.gstin || null;

    this.logger.log(
      `PAN verified successfully: ${legalName}${gstNumber ? ` | GST: ${gstNumber}` : ' | No GST linked'}`,
    );

    return {
      status: true,
      legalName,
      gstNumber: gstNumber || undefined, // Return GST only if it exists
      message: gstNumber ? 'Pan Number is valid (GST linked)' : 'Pan Number is valid (No GST linked)',
    } as IdfyVerificationResponseDto;
  }

  private parseGstResponse(
    response: any,
    gstNumber: string,
  ): IdfyGstVerificationResponseDto {
    // GST not supported
    return {
      status: false,
      message: 'GST verification not available',
      gstNumber,
    } as IdfyGstVerificationResponseDto;
  }
}

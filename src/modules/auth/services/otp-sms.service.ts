import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class OtpSmsService {
  private readonly logger = new Logger(OtpSmsService.name);

  private readonly apiUrl: string;
  private readonly user: string;
  private readonly password: string;
  private readonly sender: string;
  private readonly entityId: string;
  private readonly templateId: string;
  private readonly messageTemplate: string;

  /** The DLT-approved body, used whenever the configured one is unusable. */
  static readonly DEFAULT_OTP_MESSAGE =
    'Use OTP {#var#} to login to your Pharmabag account';

  /** Placeholders the renderer knows how to substitute. */
  static readonly OTP_PLACEHOLDER =
    /\{otp\}|\[otp\]|<otp>|\{#var#\}|\{%otp%\}/gi;

  constructor(private readonly configService: ConfigService) {
    this.apiUrl =
      this.configService.get<string>('NIMBUS_API_URL') ||
      'http://nimbusit.biz/api/SmsApi/SendSingleApi';

    this.user = this.configService.get<string>('NIMBUS_USER') || '';

    // Support both NIMBUS_PASSWORD and NIMBUS_KEY (as mentioned in docs)
    this.password =
      this.configService.get<string>('NIMBUS_PASSWORD') ||
      this.configService.get<string>('NIMBUS_KEY') ||
      '';

    this.sender = this.configService.get<string>('NIMBUS_SENDER') || 'PHABAG';
    this.entityId = this.configService.get<string>('NIMBUS_ENTITY_ID') || '';

    // DLT template registered on the jaipharmabiz account. The message body
    // below must match the registered text character for character — operators
    // silently drop messages whose text drifts from the approved template.
    this.templateId =
      this.configService.get<string>('NIMBUS_TEMPLATE_ID') ||
      '1707164786061344379';

    this.messageTemplate = this.resolveTemplate();

    if (!this.user || !this.password) {
      this.logger.warn('Nimbus SMS credentials (NIMBUS_USER/NIMBUS_KEY) missing!');
    }
  }

  /**
   * NIMBUS_OTP_MESSAGE has to survive a trip through the .env file, and the
   * DLT body contains a '#'. Unquoted, dotenv reads that as the start of an
   * inline comment and silently truncates
   *
   *   NIMBUS_OTP_MESSAGE=Use OTP {#var#} to login to your Pharmabag account
   *
   * down to "Use OTP {". That is what shipped on 2026-10-24: the SMS went out
   * with no code in it at all, and because the gateway still answered
   * Status:"OK" nothing anywhere reported a problem.
   *
   * A body with no placeholder can never produce a usable OTP, so treat it as
   * misconfiguration and fall back to the approved default rather than send
   * nonsense to a customer.
   */
  private resolveTemplate(): string {
    const configured = this.configService
      .get<string>('NIMBUS_OTP_MESSAGE')
      ?.trim();

    if (!configured) {
      return OtpSmsService.DEFAULT_OTP_MESSAGE;
    }

    // .lastIndex is shared state on a /g regex — test against a fresh one.
    const hasPlaceholder = new RegExp(
      OtpSmsService.OTP_PLACEHOLDER.source,
      'i',
    ).test(configured);

    if (!hasPlaceholder) {
      this.logger.error(
        `NIMBUS_OTP_MESSAGE has no OTP placeholder (got ${JSON.stringify(
          configured,
        )}). If the value contains '#', it must be quoted in .env or dotenv ` +
          'truncates it at the comment marker. Falling back to the default template.',
      );
      return OtpSmsService.DEFAULT_OTP_MESSAGE;
    }

    return configured;
  }

  // ==============================
  // MAIN FUNCTION
  // ==============================
  async sendOtp(phone: string, otp: string): Promise<any> {
    if (!phone || !otp) {
      throw new HttpException(
        'Phone and OTP required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const formattedPhone = this.formatPhone(phone);

    // Robust replacement: handles {otp}, [otp], <otp>, {#var#}, or {%otp%} case-insensitively
    // We intentionally do not use \botp\b to avoid matching the literal word "OTP" in the template.
    // Built fresh each call: a shared /g regex carries .lastIndex between uses.
    const message = this.messageTemplate.replace(
      new RegExp(OtpSmsService.OTP_PLACEHOLDER.source, 'gi'),
      otp,
    );

    this.logger.log(`Final message being sent: ${message}`);
    this.logger.log(`Sending OTP to ${formattedPhone}`);

    const params = {
      UserID: this.user,
      Password: this.password,
      SenderID: this.sender,
      Phno: formattedPhone,
      Msg: message,
      EntityID: this.entityId,
      TemplateID: this.templateId,
    };

    try {
      const response = await this.retryRequest(() =>
        axios.get(this.apiUrl, {
          params,
          timeout: 10000,
        }),
      );

      const data = response.data;

      const isSuccess =
        typeof data === 'string'
          ? data.toLowerCase().includes('success')
          : data?.status === 'success';

      if (!isSuccess) {
        this.logger.warn(`SMS may have failed: ${JSON.stringify(data)}`);
      }

      this.logger.log(`SMS Response: ${JSON.stringify(data)}`);

      return {
        success: isSuccess,
        response: data,
      };
    } catch (error) {
      this.logger.error(`SMS FAILED: ${error.message}`);

      throw new HttpException(
        'Failed to send OTP',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  // ==============================
  // PHONE FORMAT FIX
  // ==============================
  private formatPhone(phone: string): string {
    let clean = phone.replace(/\D/g, '');

    // If it's a standard 10-digit Indian number, prepend 91
    if (clean.length === 10) {
      clean = '91' + clean;
    }

    // India format: 0XXXXXXXXXX → 91XXXXXXXXXX
    if (clean.startsWith('0') && clean.length === 11) {
      clean = '91' + clean.substring(1);
    }

    if (clean.length < 12) {
      this.logger.warn(`Phone number ${phone} may be too short for international format`);
    }

    return clean;
  }

  // ==============================
  // RETRY LOGIC
  // ==============================
  private async retryRequest(fn: () => Promise<any>, retries = 3) {
    let lastError;

    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        this.logger.warn(`Retry ${i + 1} failed`);

        if (i === retries - 1) break;
      }
    }

    throw lastError;
  }

  // ==============================
  // OPTIONAL: DEV MODE
  // ==============================
  logOtpForDevelopment(phone: string, otp: string) {
    this.logger.debug(`[DEV OTP] ${phone} → ${otp}`);
    return {
      success: true,
      message: 'OTP logged (dev mode)',
    };
  }

  // ==============================
  // CHECK CONFIG
  // ==============================
  isConfigured(): boolean {
    return !!(this.user && this.password);
  }

  getTemplate(): string {
    return this.messageTemplate;
  }
}
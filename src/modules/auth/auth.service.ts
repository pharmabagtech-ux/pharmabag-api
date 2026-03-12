import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
  Inject,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { REDIS_CLIENT } from '../../config/redis.config';
import { Role, UserStatus } from '@prisma/client';

// ─── Constants ───────────────────────────────────────

const OTP_TTL_SECONDS = 120; // 2 minutes
const OTP_RATE_LIMIT_WINDOW = 60; // 1 minute
const OTP_RATE_LIMIT_MAX = 3; // max 3 OTPs per minute per phone

// ─── Interfaces ──────────────────────────────────────

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse extends TokenPair {
  user: {
    id: string;
    phone: string;
    email: string | null;
    role: Role;
    status: UserStatus;
  };
  isNewUser: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ─── SEND OTP ──────────────────────────────────────

  async sendOtp(phone: string): Promise<{ message: string }> {
    // Rate limiting: max 3 OTP requests per minute per phone
    await this.enforceRateLimit(phone);

    // Generate 6-digit OTP
    const otp = this.generateOtp();

    // Store OTP in Redis with TTL
    const redisKey = `otp:${phone}`;
    await this.redis.setex(redisKey, OTP_TTL_SECONDS, otp);

    // Increment rate limit counter
    const rateLimitKey = `otp_rate:${phone}`;
    const currentCount = await this.redis.incr(rateLimitKey);
    if (currentCount === 1) {
      await this.redis.expire(rateLimitKey, OTP_RATE_LIMIT_WINDOW);
    }

    // TODO: Replace with actual SMS provider (MSG91 / Twilio / AWS SNS)
    this.logger.debug(`[DEV] OTP for ${phone}: ${otp}`);

    return { message: 'OTP sent successfully' };
  }

  // ─── VERIFY OTP ────────────────────────────────────

  async verifyOtp(phone: string, otp: string): Promise<AuthResponse> {
    const redisKey = `otp:${phone}`;

    // Fetch stored OTP from Redis
    const storedOtp = await this.redis.get(redisKey);

    if (!storedOtp) {
      throw new BadRequestException('OTP expired or not found. Please request a new OTP.');
    }

    // Constant-time comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(Buffer.from(otp), Buffer.from(storedOtp))) {
      throw new BadRequestException('Invalid OTP');
    }

    // Delete OTP from Redis (single use)
    await this.redis.del(redisKey);

    // Find or create user
    let isNewUser = false;
    let user = await this.prisma.user.findUnique({
      where: { phone },
      select: {
        id: true,
        phone: true,
        email: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      isNewUser = true;

      // Generate a random placeholder password (user authenticates via OTP, not password)
      const randomPassword = crypto.randomBytes(32).toString('hex');

      user = await this.prisma.user.create({
        data: {
          phone,
          password: randomPassword,
          role: Role.BUYER,
          status: UserStatus.PENDING,
        },
        select: {
          id: true,
          phone: true,
          email: true,
          role: true,
          status: true,
        },
      });

      this.logger.log(`New user registered: ${phone} (${user.id})`);
    }

    // Generate JWT tokens
    const tokens = await this.generateTokens(user.id, user.role);

    return {
      ...tokens,
      user,
      isNewUser,
    };
  }

  // ─── GET CURRENT USER (ME) ─────────────────────────

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        buyerProfile: {
          select: {
            id: true,
            legalName: true,
            city: true,
            state: true,
          },
        },
        sellerProfile: {
          select: {
            id: true,
            companyName: true,
            verificationStatus: true,
            city: true,
            state: true,
          },
        },
        adminProfile: {
          select: {
            id: true,
            displayName: true,
            department: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  // ─── REFRESH TOKEN ─────────────────────────────────

  async refreshToken(refreshToken: string): Promise<TokenPair> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      // Verify user still exists and is not blocked
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, status: true },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      if (user.status === 'BLOCKED') {
        throw new UnauthorizedException('Account is blocked');
      }

      return this.generateTokens(user.id, user.role);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  // ─── PRIVATE HELPERS ───────────────────────────────

  private generateOtp(): string {
    // Cryptographically secure 6-digit OTP
    const buffer = crypto.randomBytes(4);
    const num = buffer.readUInt32BE(0) % 900000;
    return String(num + 100000);
  }

  private async generateTokens(userId: string, role: Role): Promise<TokenPair> {
    const payload = { sub: userId, role };

    const accessExpiresIn = this.configService.get<string>('JWT_ACCESS_EXPIRES', '15m');
    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES', '7d');

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        expiresIn: accessExpiresIn as any,
      }),
      this.jwtService.signAsync(payload, {
        expiresIn: refreshExpiresIn as any,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async enforceRateLimit(phone: string): Promise<void> {
    const rateLimitKey = `otp_rate:${phone}`;
    const count = await this.redis.get(rateLimitKey);

    if (count && parseInt(count, 10) >= OTP_RATE_LIMIT_MAX) {
      throw new HttpException(
        'Too many OTP requests. Please try again after 1 minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

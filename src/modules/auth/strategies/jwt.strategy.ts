import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../database/prisma.service';

export interface JwtPayload {
  sub: string; // userId
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is not defined in environment variables');
    }

    super({
      // Was logging the raw Authorization header and the extracted token on
      // every authenticated request, writing live session tokens into the
      // container logs in plain text.
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        phone: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        // Read per request rather than baked into the token, so revoking an
        // admin's access takes effect immediately instead of whenever their
        // token happens to expire. This query already ran; only admins have a
        // row here at all.
        adminProfile: { select: { permissions: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status === 'BLOCKED') {
      throw new UnauthorizedException('Account is blocked');
    }

    return user;
  }
}

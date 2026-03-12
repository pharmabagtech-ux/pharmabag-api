import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateBuyerProfileDto } from './dto/create-buyer-profile.dto';
import { UpdateBuyerProfileDto } from './dto/update-buyer-profile.dto';

@Injectable()
export class BuyersService {
  private readonly logger = new Logger(BuyersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new buyer profile for an authenticated BUYER user.
   * Throws ConflictException if profile already exists.
   */
  async createProfile(userId: string, dto: CreateBuyerProfileDto) {
    const existing = await this.prisma.buyerProfile.findUnique({
      where: { userId },
    });

    if (existing) {
      throw new ConflictException('Buyer profile already exists');
    }

    const profile = await this.prisma.buyerProfile.create({
      data: {
        userId,
        legalName: dto.legalName,
        gstNumber: dto.gstNumber,
        panNumber: dto.panNumber,
        drugLicenseNumber: dto.drugLicenseNumber,
        drugLicenseUrl: dto.drugLicenseUrl,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
        latitude: dto.latitude,
        longitude: dto.longitude,
      },
    });

    this.logger.log(`Buyer profile created for user ${userId}`);
    return profile;
  }

  /**
   * Get the buyer profile for an authenticated user.
   */
  async getProfile(userId: string) {
    const profile = await this.prisma.buyerProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Buyer profile not found');
    }

    return profile;
  }

  /**
   * Partially update the buyer profile.
   */
  async updateProfile(userId: string, dto: UpdateBuyerProfileDto) {
    const existing = await this.prisma.buyerProfile.findUnique({
      where: { userId },
    });

    if (!existing) {
      throw new NotFoundException(
        'Buyer profile not found. Create a profile first.',
      );
    }

    const profile = await this.prisma.buyerProfile.update({
      where: { userId },
      data: dto,
    });

    this.logger.log(`Buyer profile updated for user ${userId}`);
    return profile;
  }
}

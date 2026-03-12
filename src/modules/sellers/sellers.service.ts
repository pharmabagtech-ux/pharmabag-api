import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateSellerProfileDto } from './dto/create-seller-profile.dto';
import { UpdateSellerProfileDto } from './dto/update-seller-profile.dto';

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new seller profile for an authenticated SELLER user.
   * Sets default verificationStatus = UNVERIFIED, rating = 0.
   */
  async createProfile(userId: string, dto: CreateSellerProfileDto) {
    const existing = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (existing) {
      throw new ConflictException('Seller profile already exists');
    }

    const profile = await this.prisma.sellerProfile.create({
      data: {
        userId,
        companyName: dto.companyName,
        gstNumber: dto.gstNumber,
        panNumber: dto.panNumber,
        drugLicenseNumber: dto.drugLicenseNumber,
        drugLicenseUrl: dto.drugLicenseUrl,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
        verificationStatus: 'UNVERIFIED',
        rating: 0,
      },
    });

    this.logger.log(`Seller profile created for user ${userId}`);
    return profile;
  }

  /**
   * Get the seller profile for an authenticated user.
   */
  async getProfile(userId: string) {
    const profile = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Seller profile not found');
    }

    return profile;
  }

  /**
   * Partially update the seller profile.
   */
  async updateProfile(userId: string, dto: UpdateSellerProfileDto) {
    const existing = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!existing) {
      throw new NotFoundException(
        'Seller profile not found. Create a profile first.',
      );
    }

    const profile = await this.prisma.sellerProfile.update({
      where: { userId },
      data: dto,
    });

    this.logger.log(`Seller profile updated for user ${userId}`);
    return profile;
  }
}

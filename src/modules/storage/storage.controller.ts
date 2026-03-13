import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { StorageService } from './storage.service';
import { memoryStorage } from 'multer';

const multerOptions = {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
};

@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('product-image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @HttpCode(HttpStatus.CREATED)
  async uploadProductImage(@UploadedFile() file: Express.Multer.File) {
    const url = await this.storageService.uploadProductImage(file);
    return { message: 'Product image uploaded', data: { url } };
  }

  @Post('payment-proof')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @HttpCode(HttpStatus.CREATED)
  async uploadPaymentProof(@UploadedFile() file: Express.Multer.File) {
    const url = await this.storageService.uploadPaymentProof(file);
    return { message: 'Payment proof uploaded', data: { url } };
  }

  @Post('kyc')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER, Role.SELLER)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @HttpCode(HttpStatus.CREATED)
  async uploadKycDocument(@UploadedFile() file: Express.Multer.File) {
    const url = await this.storageService.uploadKycDocument(file);
    return { message: 'KYC document uploaded', data: { url } };
  }
}

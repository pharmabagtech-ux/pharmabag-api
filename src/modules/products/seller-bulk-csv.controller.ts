import {
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpException,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import { SellerBulkCsvService } from './services/seller-bulk-csv.service';

@ApiTags('Seller Bulk CSV')
@Controller('products/bulk-csv')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SELLER)
@ApiBearerAuth('JWT-auth')
export class SellerBulkCsvController {
  constructor(private readonly bulkCsvService: SellerBulkCsvService) {}

  @Get('template')
  @ApiOperation({ summary: 'Download master catalog as a CSV template for bulk upload' })
  async downloadTemplate(@Res() res: Response) {
    try {
      const csv = await this.bulkCsvService.generateTemplate();
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=pharmabag-product-template.csv');
      res.status(HttpStatus.OK).send(csv);
    } catch {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Failed to generate template');
    }
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Bulk upload seller products via CSV (name must match master catalog)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async uploadCsv(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
  ) {
    if (!file) {
      throw new HttpException('CSV file is required', HttpStatus.BAD_REQUEST);
    }
    const result = await this.bulkCsvService.processUpload(file.buffer, userId);
    return { message: 'Bulk upload processed', data: result };
  }
}

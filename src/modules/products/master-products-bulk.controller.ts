import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  HttpException,
  HttpStatus,
  Get,
  Patch,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MasterProductsBulkService } from './services/master-products-bulk.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import type { Express, Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';

@ApiTags('Master Products Bulk')
@Controller('master-products/bulk')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class MasterProductsBulkController {
  constructor(private readonly bulkService: MasterProductsBulkService) {}

  @Post('new')
  @UseInterceptors(FileInterceptor('file'))
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Bulk upload NEW master products via CSV' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async uploadNew(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new HttpException('CSV file is required', HttpStatus.BAD_REQUEST);
    }
    const result = await this.bulkService.processBulkCsv(file.buffer, 'NEW');
    return { message: 'Bulk new processing completed', data: result };
  }

  @Post('update')
  @UseInterceptors(FileInterceptor('file'))
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Bulk UPDATE master products via CSV based on SKU' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async uploadUpdate(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new HttpException('CSV file is required', HttpStatus.BAD_REQUEST);
    }
    const result = await this.bulkService.processBulkCsv(file.buffer, 'UPDATE');
    return { message: 'Bulk update processing completed', data: result };
  }

  @Post('delete')
  @UseInterceptors(FileInterceptor('file'))
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Bulk DELETE master products via CSV (Hard delete) based on SKU' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async uploadDelete(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new HttpException('CSV file is required', HttpStatus.BAD_REQUEST);
    }
    const result = await this.bulkService.processBulkCsv(file.buffer, 'DELETE');
    return { message: 'Bulk delete processing completed', data: result };
  }

  @Patch('activate-all')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Activate all inactive master products so sellers can search and add them' })
  async activateAll() {
    const result = await this.bulkService.activateAll();
    return { message: `Activated ${result.count} master products`, data: result };
  }

  @Get('export')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Export all active master products to CSV' })
  async exportCsv(@Res() res: Response) {
    try {
      const csvData = await this.bulkService.exportToCsv();
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=master-products-export.csv');
      res.status(HttpStatus.OK).send(csvData);
    } catch (err) {
      throw new HttpException('Failed to export CSV', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

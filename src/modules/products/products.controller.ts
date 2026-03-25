import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { BulkCreateProductDto } from './dto/bulk-create-product.dto';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // ──────────────────────────────────────────────
  // PUBLIC ENDPOINTS (No auth required)
  // ──────────────────────────────────────────────

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Browse products with filtering & pagination' })
  @ApiResponse({ status: 200, description: 'Paginated product list' })
  async findAll(@Query() query: QueryProductDto) {
    const data = await this.productsService.findAll(query);
    return { message: 'Products retrieved successfully', data };
  }

  @Get('categories')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all categories with sub-categories' })
  @ApiResponse({ status: 200, description: 'Category tree returned' })
  async getCategories() {
    const data = await this.productsService.getCategories();
    return { message: 'Categories retrieved successfully', data };
  }

  @Get('suggestions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get product name suggestions for autocomplete' })
  @ApiResponse({ status: 200, description: 'Suggestions returned' })
  async getSuggestions(@Query('q') q: string) {
    const data = await this.productsService.getSuggestions(q);
    return { message: 'Suggestions retrieved successfully', data };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get single product by ID' })
  @ApiResponse({ status: 200, description: 'Product details returned' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async findOne(@Param('id') id: string) {
    const data = await this.productsService.findOne(id);
    return { message: 'Product retrieved successfully', data };
  }

  // ──────────────────────────────────────────────
  // SELLER ENDPOINTS (Auth + SELLER role required)
  // ──────────────────────────────────────────────

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a new product (seller only)' })
  @ApiResponse({ status: 201, description: 'Product created' })
  @ApiResponse({ status: 403, description: 'Forbidden — not a seller' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateProductDto,
  ) {
    const data = await this.productsService.create(userId, dto);
    return { message: 'Product created successfully', data };
  }

  @Post('bulk')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Bulk-create products (seller only, migration-friendly)' })
  @ApiResponse({ status: 201, description: 'Bulk creation results returned' })
  async bulkCreate(
    @CurrentUser('id') userId: string,
    @Body() dto: BulkCreateProductDto,
  ) {
    const data = await this.productsService.bulkCreate(userId, dto);
    return { message: 'Bulk product creation completed', data };
  }

  @Get('seller/own')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List own products (seller only)' })
  @ApiResponse({ status: 200, description: 'Seller products returned' })
  async findOwn(
    @CurrentUser('id') userId: string,
    @Query() query: QueryProductDto,
  ) {
    const data = await this.productsService.findOwn(userId, query);
    return { message: 'Products retrieved successfully', data };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update own product (seller only)' })
  @ApiResponse({ status: 200, description: 'Product updated' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    const data = await this.productsService.update(userId, id, dto);
    return { message: 'Product updated successfully', data };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Soft-delete own product (seller only)' })
  @ApiResponse({ status: 200, description: 'Product deleted' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    const data = await this.productsService.softDelete(userId, id);
    return data;
  }
}

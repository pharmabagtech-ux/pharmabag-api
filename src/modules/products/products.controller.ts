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
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // ──────────────────────────────────────────────
  // PUBLIC ENDPOINTS (No auth required)
  // ──────────────────────────────────────────────

  /** Browse all active products with filtering & pagination */
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() query: QueryProductDto) {
    const data = await this.productsService.findAll(query);
    return { message: 'Products retrieved successfully', data };
  }

  /** List all categories with sub-categories */
  @Get('categories')
  @HttpCode(HttpStatus.OK)
  async getCategories() {
    const data = await this.productsService.getCategories();
    return { message: 'Categories retrieved successfully', data };
  }

  /** Get a single product by ID */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    const data = await this.productsService.findOne(id);
    return { message: 'Product retrieved successfully', data };
  }

  // ──────────────────────────────────────────────
  // SELLER ENDPOINTS (Auth + SELLER role required)
  // ──────────────────────────────────────────────

  /** Create a new product (seller only) */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateProductDto,
  ) {
    const data = await this.productsService.create(userId, dto);
    return { message: 'Product created successfully', data };
  }

  /** List own products (seller only) */
  @Get('seller/own')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  async findOwn(
    @CurrentUser('id') userId: string,
    @Query() query: QueryProductDto,
  ) {
    const data = await this.productsService.findOwn(userId, query);
    return { message: 'Products retrieved successfully', data };
  }

  /** Update own product (seller only) */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    const data = await this.productsService.update(userId, id, dto);
    return { message: 'Product updated successfully', data };
  }

  /** Soft-delete own product (seller only) */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    const data = await this.productsService.softDelete(userId, id);
    return data;
  }
}

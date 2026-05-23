import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { InventoryService } from './services/inventory.service';
import { SearchIndexService } from './services/search-index.service';
import { AnalyticsService } from './services/analytics.service';
import { MasterProductsBulkController } from './master-products-bulk.controller';
import { MasterProductsBulkService } from './services/master-products-bulk.service';

@Module({
  controllers: [ProductsController, MasterProductsBulkController],
  providers: [
    ProductsService,
    InventoryService,
    SearchIndexService,
    AnalyticsService,
    MasterProductsBulkService,
  ],
  exports: [ProductsService, InventoryService, AnalyticsService, MasterProductsBulkService],
})
export class ProductsModule {}

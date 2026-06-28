import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { InventoryService } from './services/inventory.service';
import { SearchIndexService } from './services/search-index.service';
import { AnalyticsService } from './services/analytics.service';
import { MasterProductsBulkController } from './master-products-bulk.controller';
import { MasterProductsBulkService } from './services/master-products-bulk.service';
import { SellerBulkCsvController } from './seller-bulk-csv.controller';
import { SellerBulkCsvService } from './services/seller-bulk-csv.service';

@Module({
  controllers: [ProductsController, MasterProductsBulkController, SellerBulkCsvController],
  providers: [
    ProductsService,
    InventoryService,
    SearchIndexService,
    AnalyticsService,
    MasterProductsBulkService,
    SellerBulkCsvService,
  ],
  exports: [ProductsService, InventoryService, AnalyticsService, MasterProductsBulkService],
})
export class ProductsModule {}

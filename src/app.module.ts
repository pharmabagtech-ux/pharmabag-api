import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Infrastructure modules
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './config/redis.module';
import { HealthModule } from './health/health.module';

// Feature modules
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { BuyersModule } from './modules/buyers/buyers.module';
import { SellersModule } from './modules/sellers/sellers.module';
import { ProductsModule } from './modules/products/products.module';
import { CartModule } from './modules/cart/cart.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminModule } from './modules/admin/admin.module';
import { StorageModule } from './modules/storage/storage.module';
import { SettlementsModule } from './modules/settlements/settlements.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { TicketsModule } from './modules/tickets/tickets.module';

// Middleware
import { LoggerMiddleware } from './common/middleware/logger.middleware';

@Module({
  imports: [
    // Global config
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Infrastructure
    DatabaseModule,
    RedisModule,
    HealthModule,

    // Feature modules
    AuthModule,
    UsersModule,
    BuyersModule,
    SellersModule,
    ProductsModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    NotificationsModule,
    AdminModule,
    StorageModule,
    SettlementsModule,
    ReviewsModule,
    TicketsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*path');
  }
}

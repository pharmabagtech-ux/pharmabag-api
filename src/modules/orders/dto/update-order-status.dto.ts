import { IsEnum } from 'class-validator';
import { OrderStatus } from '@prisma/client';

export class UpdateOrderStatusDto {
  @IsEnum(
    {
      ACCEPTED: OrderStatus.ACCEPTED,
      SHIPPED: OrderStatus.SHIPPED,
      OUT_FOR_DELIVERY: OrderStatus.OUT_FOR_DELIVERY,
      DELIVERED: OrderStatus.DELIVERED,
    },
    {
      message:
        'Status must be one of: ACCEPTED, SHIPPED, OUT_FOR_DELIVERY, DELIVERED',
    },
  )
  status: OrderStatus;
}

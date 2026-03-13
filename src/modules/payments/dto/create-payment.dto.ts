import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class CreatePaymentDto {
  @IsUUID('4', { message: 'orderId must be a valid UUID' })
  @IsNotEmpty({ message: 'orderId is required' })
  orderId: string;

  @IsNumber({}, { message: 'amount must be a number' })
  @IsPositive({ message: 'amount must be a positive number' })
  @IsNotEmpty({ message: 'amount is required' })
  amount: number;

  @IsEnum(PaymentMethod, {
    message: `method must be one of: ${Object.values(PaymentMethod).join(', ')}`,
  })
  @IsNotEmpty({ message: 'method is required' })
  method: PaymentMethod;

  @IsString()
  @IsOptional()
  referenceNumber?: string;
}

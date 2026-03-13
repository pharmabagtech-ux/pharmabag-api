import { IsOptional, IsString } from 'class-validator';

export class ConfirmPaymentDto {
  @IsString()
  @IsOptional()
  remarks?: string;
}

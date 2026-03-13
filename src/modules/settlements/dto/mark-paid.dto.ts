import { IsNotEmpty, IsString } from 'class-validator';

export class MarkPaidDto {
  @IsString()
  @IsNotEmpty({ message: 'Payout reference is required' })
  payoutReference: string;
}

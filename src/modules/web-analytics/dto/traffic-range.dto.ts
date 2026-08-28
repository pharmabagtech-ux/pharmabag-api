import { IsDateString } from 'class-validator';

export class TrafficRangeDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}

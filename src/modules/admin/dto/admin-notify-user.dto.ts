import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminNotifyUserDto {
  @ApiProperty({ example: 'Your business profile has been verified. You can now place orders on PharmaBag.' })
  @IsString()
  @IsNotEmpty()
  message: string;

  /**
   * Accepted because the admin panel has always sent them, and rejecting the
   * payload would break the caller. Neither is stored: the notifications table
   * has a single `message` column, so a heading has nowhere to live and the
   * buyer and seller apps already show "Notification" above every row.
   */
  @ApiPropertyOptional({ example: 'Account Verified!' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'verification' })
  @IsOptional()
  @IsString()
  type?: string;
}

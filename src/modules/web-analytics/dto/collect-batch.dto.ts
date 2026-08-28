// src/modules/web-analytics/dto/collect-batch.dto.ts
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ArrayMaxSize } from 'class-validator';

export class VisitorPayloadDto {
  @IsUUID()
  id: string;
}

export class SessionPayloadDto {
  @IsUUID()
  id: string;

  @IsOptional()
  @IsBoolean()
  isNew?: boolean;

  @IsOptional()
  @IsBoolean()
  isNewVisitor?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  landingPage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  referrer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  medium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  campaign?: string;

  @IsOptional()
  @IsObject()
  clickIds?: Record<string, string>;

  // Set by the tracker's identify() once a buyer/seller is logged in.
  // Self-reported, same trust level as the rest of this analytics payload —
  // this is not an authorization boundary.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  userId?: string;
}

export class EventPayloadDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsNumber()
  ts: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  page?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  productId?: string;

  @IsOptional()
  @IsObject()
  props?: Record<string, unknown>;
}

export class CollectBatchDto {
  @ValidateNested()
  @Type(() => VisitorPayloadDto)
  visitor: VisitorPayloadDto;

  @ValidateNested()
  @Type(() => SessionPayloadDto)
  session: SessionPayloadDto;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EventPayloadDto)
  events: EventPayloadDto[];

  // Attached server-side by the buyer app's /api/track proxy from the raw
  // User-Agent header — never sent by the client tracker itself.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  ua?: string;
}

import {
  IsArray,
  IsInt,
  IsIP,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ChangesetChangeDto } from '../common/dto/changeset.dto';

export const NETWORK_WRITABLE_FIELDS = [
  'name',
  'homeAddress',
  'homeLatitude',
  'homeLongitude',
  'homePublicIp',
  'isp',
  'downMbps',
  'upMbps',
] as const;

export class CreateNetworkDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.trim())
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  homeAddress?: string;

  @IsOptional()
  @IsLatitude()
  homeLatitude?: number;

  @IsOptional()
  @IsLongitude()
  homeLongitude?: number;

  @IsOptional()
  @IsIP()
  homePublicIp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  isp?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  downMbps?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  upMbps?: number;
}

export class PatchNetworkDto {
  @IsInt()
  @Min(1)
  baseVersion: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ChangesetChangeDto)
  changes: ChangesetChangeDto[];
}

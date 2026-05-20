import {
  Allow,
  IsArray,
  IsEnum,
  IsInt,
  IsIP,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  IsNumber,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { DeviceCategory } from '@prisma/client';

export const DEVICE_WRITABLE_FIELDS = [
  'name',
  'category',
  'latitude',
  'longitude',
  'floor',
  'floorLabel',
  'ipAddress',
  'macAddress',
  'notes',
] as const;

export class CreateDeviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.trim())
  name: string;

  @IsEnum(DeviceCategory)
  category: DeviceCategory;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsInt()
  @Min(-10)
  @Max(200)
  floor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }: { value: string }) => value?.trim())
  floorLabel?: string;

  @IsOptional()
  @IsIP()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/, {
    message: 'macAddress must be in XX:XX:XX:XX:XX:XX format',
  })
  macAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

class ChangesetChangeDto {
  @IsString()
  field: string;

  @Allow()
  oldValue: unknown;

  @Allow()
  newValue: unknown;
}

export class PatchDeviceDto {
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

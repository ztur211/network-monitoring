import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export const FIBER_RUN_WRITABLE_FIELDS = ['name', 'cableType', 'lengthMeters', 'notes'] as const;

export class CreateFiberRunDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.trim())
  name: string;

  @IsUUID()
  startDeviceId: string;

  @IsUUID()
  endDeviceId: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }: { value: string }) => value?.trim())
  cableType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(100000)
  lengthMeters?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

class ChangesetChangeDto {
  @IsString()
  field: string;

  oldValue: unknown;
  newValue: unknown;
}

export class PatchFiberRunDto {
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

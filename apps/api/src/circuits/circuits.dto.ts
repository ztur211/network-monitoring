import {
  Allow,
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

export const CIRCUIT_WRITABLE_FIELDS = [
  'ispName',
  'circuitId',
  'serviceType',
  'bandwidth',
  'deviceId',
  'notes',
] as const;

export class CreateCircuitDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.trim())
  ispName: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.trim())
  circuitId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Transform(({ value }: { value: string }) => value?.trim())
  serviceType: string;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(100000)
  bandwidth?: number;

  @IsOptional()
  @IsUUID()
  deviceId?: string;

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

export class PatchCircuitDto {
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

export class ListCircuitsQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }: { value: string }) => parseInt(value, 10))
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

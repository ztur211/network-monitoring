import {
  Allow,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ConnectionType } from '@prisma/client';

export const CONNECTION_WRITABLE_FIELDS = ['connectionType', 'notes'] as const;

export class CreateConnectionDto {
  @IsUUID()
  sourceDeviceId: string;

  @IsUUID()
  targetDeviceId: string;

  @IsEnum(ConnectionType)
  connectionType: ConnectionType;

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

export class PatchConnectionDto {
  @IsInt()
  @Min(1)
  baseVersion: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ChangesetChangeDto)
  changes: ChangesetChangeDto[];
}

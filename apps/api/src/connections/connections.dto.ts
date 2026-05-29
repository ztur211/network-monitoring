import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ConnectionType } from '@prisma/client';
import { ChangesetChangeDto } from '../common/dto/changeset.dto';

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

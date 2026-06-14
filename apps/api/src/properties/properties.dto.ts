import {
  IsString,
  MinLength,
  MaxLength,
  IsEnum,
  IsOptional,
  IsUUID,
  IsInt,
  Min,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PropertyType } from '@prisma/client';
import { ChangesetChangeDto } from '../common/dto/changeset.dto';

export class CreatePropertyDto {
  @IsEnum(PropertyType) type: PropertyType;
  @IsOptional() @IsUUID() parentId?: string;
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(32) code?: string;
}

export const PROPERTY_WRITABLE_FIELDS = ['name', 'code', 'parentId'] as const;

export class PatchPropertyDto {
  @IsInt() @Min(1) baseVersion: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10)
  @ValidateNested({ each: true }) @Type(() => ChangesetChangeDto)
  changes: ChangesetChangeDto[];
}

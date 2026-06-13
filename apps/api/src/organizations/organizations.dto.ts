import {
  IsString,
  MinLength,
  MaxLength,
  IsEmail,
  IsInt,
  Min,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ChangesetChangeDto } from '../common/dto/changeset.dto';

export class CreateOrganizationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;
}

export class AddDomainDto {
  @IsString()
  @MinLength(3)
  @MaxLength(253)
  domain: string;
}

export class DesignateOwnerDto {
  @IsEmail()
  email: string;
}

export const ORG_WRITABLE_FIELDS = ['name', 'namingPattern', 'namingMaxLen'] as const;

export class PatchOrganizationDto {
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

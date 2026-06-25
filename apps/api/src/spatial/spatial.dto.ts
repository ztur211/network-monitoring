import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class DevicePositionInputDto {
  @IsOptional()
  @IsNumber()
  x!: number | null;

  @IsOptional()
  @IsNumber()
  y!: number | null;

  @IsOptional()
  @IsNumber()
  z!: number | null;
}

export class DeviceIfcLinkInputDto {
  // @IsOptional treats null/undefined as "absent" (skips @IsString) so a clear request
  // ({ ifcGlobalId: null } or {}) passes; a provided value must be a string. 64 chars comfortably
  // covers an IFC GlobalId (22 base-64 chars) plus any vendor-prefixed variants.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ifcGlobalId!: string | null;
}

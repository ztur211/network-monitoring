import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator';

export type AssignTargetType = 'network' | 'device';

export class AssignSnmpDto {
  @IsEnum(['network', 'device'], { message: 'targetType must be network or device' })
  targetType!: AssignTargetType;

  @IsString()
  @IsNotEmpty()
  targetId!: string;

  /** Required to be present (but may be null to explicitly unassign). */
  @IsDefined()
  @ValidateIf((o, v) => v !== null)
  @IsString()
  snmpCredentialId!: string | null;

  /** Required to be present (but may be null to explicitly unassign). */
  @IsDefined()
  @ValidateIf((o, v) => v !== null)
  @IsString()
  oidProfileId!: string | null;
}

export class CreateSnmpCredentialBodyDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(['V2C', 'V3'])
  snmpVersion!: string;

  @IsOptional()
  @IsEnum(['NO_AUTH_NO_PRIV', 'AUTH_NO_PRIV', 'AUTH_PRIV'])
  securityLevel?: string;

  @IsOptional()
  @IsString()
  securityName?: string;

  @IsOptional()
  @IsEnum(['MD5', 'SHA', 'SHA256'])
  authProtocol?: string;

  @IsOptional()
  @IsEnum(['DES', 'AES', 'AES256'])
  privProtocol?: string;

  @IsOptional()
  @IsString()
  community?: string;

  @IsOptional()
  @IsString()
  authKey?: string;

  @IsOptional()
  @IsString()
  privKey?: string;
}

export class CreateOidEntryDto {
  @IsString()
  @IsNotEmpty()
  oid!: string;

  @IsString()
  @IsNotEmpty()
  metric!: string;
}

export class CreateOidProfileBodyDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsBoolean()
  includeInterfaceMetrics?: boolean;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateOidEntryDto)
  entries?: CreateOidEntryDto[];
}

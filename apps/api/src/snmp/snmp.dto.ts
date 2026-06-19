import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export type AssignTargetType = 'network' | 'device';

export class AssignSnmpDto {
  @IsEnum(['network', 'device'], { message: 'targetType must be network or device' })
  targetType!: AssignTargetType;

  @IsString()
  @IsNotEmpty()
  targetId!: string;

  @IsOptional()
  @IsString()
  snmpCredentialId?: string;

  @IsOptional()
  @IsString()
  oidProfileId?: string;
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

export class CreateOidProfileBodyDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  includeInterfaceMetrics?: boolean;

  @IsOptional()
  entries?: Array<{ oid: string; metric: string }>;
}

import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateChannelDto {
  @IsIn(['WEBHOOK', 'EMAIL', 'INAPP']) type!: 'WEBHOOK' | 'EMAIL' | 'INAPP';
  @IsString() name!: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsString() secret?: string;
}

export class CreateRuleDto {
  @IsString() name!: string;
  @IsIn(['STATE_TRANSITION', 'METRIC_THRESHOLD']) trigger!: 'STATE_TRANSITION' | 'METRIC_THRESHOLD';
  @IsObject() scope!: Record<string, unknown>;
  @IsOptional() @IsArray() @IsString({ each: true }) targetStates?: string[];
  @IsOptional() @IsString() metric?: string;
  @IsOptional() @IsIn(['gt', 'lt']) op?: 'gt' | 'lt';
  @IsOptional() @IsNumber() threshold?: number;
  @IsOptional() @IsInt() @Min(1) forSeconds?: number;
  @IsIn(['INFO', 'WARNING', 'CRITICAL']) severity!: 'INFO' | 'WARNING' | 'CRITICAL';
  @IsArray() @IsString({ each: true }) channelIds!: string[];
  @IsInt() @Min(0) cooldownSeconds!: number;
  @IsBoolean() notifyOnRecovery!: boolean;
}

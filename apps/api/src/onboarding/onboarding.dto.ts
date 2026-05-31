import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsStringOrNumberRecord } from '../common/validators/is-string-or-number-record.validator';

export class OnboardingTurnDto {
  // Required so the server can resolve the browser device row idempotently
  // — the client owns the UUID (localStorage), the server links it to a
  // Device row on SaveBrowserDevice.
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  browserDeviceId: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  userMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  chipChoice?: string;

  @IsOptional()
  @IsStringOrNumberRecord({ maxStringLength: 1000 })
  fieldValues?: Record<string, string | number>;
}

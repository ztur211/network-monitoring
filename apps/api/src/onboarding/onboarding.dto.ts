import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsStringOrNumberRecord } from '../common/validators/is-string-or-number-record.validator';

export class OnboardingTurnDto {
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

import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
  @IsObject()
  fieldValues?: Record<string, string | number>;
}

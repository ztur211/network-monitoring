import {
  IsEmail,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.trim())
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  @Transform(({ value }: { value: string }) => value?.trim().toLowerCase())
  email?: string;
}

export class SetLocationDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(({ value }: { value: string }) => value?.trim())
  address?: string;

  @ValidateIf((o: SetLocationDto) => !o.address)
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ValidateIf((o: SetLocationDto) => !o.address)
  @IsOptional()
  @IsLongitude()
  longitude?: number;
}

import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
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

export class UpdatePreferencesDto {
  @IsOptional()
  @IsBoolean()
  buildingsVisible?: boolean;

  @IsOptional()
  @IsObject()
  layerToggles?: Record<string, boolean>;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsNumber({}, { each: true })
  mapCenter?: [number, number];

  @IsOptional()
  @IsNumber()
  mapZoom?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  selectedFloor?: number | null;

  @IsOptional()
  @IsIn(['single', 'all', 'connection'])
  floorDisplayMode?: 'single' | 'all' | 'connection';
}

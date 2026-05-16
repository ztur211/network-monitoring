import { IsInt, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class MapBboxQueryDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, {
    message: 'bbox must be in format west,south,east,north (four comma-separated floats)',
  })
  bbox: string;

  @IsOptional()
  @IsInt()
  @Transform(({ value }: { value: string }) => parseInt(value, 10))
  floor?: number;
}

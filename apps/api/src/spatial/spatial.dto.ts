import { IsNumber, IsOptional } from 'class-validator';

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

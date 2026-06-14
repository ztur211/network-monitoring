import { IsInt, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTeamDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120)
  name!: string;
}

export class UpdateTeamDto {
  @IsInt() @Min(1)
  baseVersion!: number;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120)
  name!: string;
}

export class AddTeamMemberDto { @IsUUID() memberId!: string; }
export class AddTeamPropertyDto { @IsUUID() propertyId!: string; }
export class AddMemberPropertyDto { @IsUUID() propertyId!: string; }

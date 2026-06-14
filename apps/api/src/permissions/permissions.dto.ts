import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';
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

// (used by later tasks)
export class AddTeamMemberDto { @IsString() memberId!: string; }
export class AddTeamPropertyDto { @IsString() propertyId!: string; }
export class AddMemberPropertyDto { @IsString() propertyId!: string; }

import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { OrgRole } from '@prisma/client';

export class CreateInvitationDto {
  @IsEmail()
  email: string;

  @IsEnum(OrgRole)
  role: OrgRole;
}

export class AcceptInvitationDto {
  @IsString()
  @MinLength(1)
  token: string;
}

export class ChangeMemberRoleDto {
  @IsEnum(OrgRole)
  role: OrgRole;
}

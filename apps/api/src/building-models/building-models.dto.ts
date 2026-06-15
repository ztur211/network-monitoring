import { IsString } from 'class-validator';

export class ActivateVersionDto {
  @IsString()
  versionId!: string;
}

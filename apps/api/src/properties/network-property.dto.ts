import { IsUUID } from 'class-validator';

export class AddCharterDto {
  @IsUUID()
  propertyId: string;
}

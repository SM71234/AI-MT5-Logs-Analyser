import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateInvestigationDto {
  @IsUUID('4', { message: 'Broker ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Broker ID is required' })
  brokerId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Client login ID is required' })
  login!: string;

  @IsString()
  @IsNotEmpty({ message: 'Trade Ticket ID is required' })
  ticket!: string;
}

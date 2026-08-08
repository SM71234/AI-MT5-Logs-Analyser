import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class GetTradesDto {
  @IsUUID('4', { message: 'Broker ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Broker ID is required' })
  brokerId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Client Login ID is required' })
  login!: string;
}

import { IsNotEmpty, IsInt, IsString, Min, Max, MinLength } from 'class-validator';

export class CreateBrokerDto {
  @IsString()
  @IsNotEmpty({ message: 'Broker connection name is required' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: 'Server address is required' })
  serverAddress!: string;

  @IsInt()
  @Min(1, { message: 'Port must be a positive integer' })
  @Max(65535, { message: 'Port must be a valid port number' })
  port!: number;

  @IsString()
  @IsNotEmpty({ message: 'Manager login ID is required' })
  managerLogin!: string;

  @IsString()
  @IsNotEmpty({ message: 'Manager password is required' })
  @MinLength(4, { message: 'Password must be at least 4 characters long' })
  password!: string;
}

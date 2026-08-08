import { IsNotEmpty, IsInt, IsString, Min, Max, MinLength, IsOptional } from 'class-validator';

export class UpdateBrokerDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  serverAddress?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  port?: number;

  @IsString()
  @IsOptional()
  managerLogin?: string;

  @IsString()
  @IsOptional()
  @MinLength(4)
  password?: string;
}

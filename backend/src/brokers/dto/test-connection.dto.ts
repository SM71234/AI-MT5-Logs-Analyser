import { IsNotEmpty, IsInt, IsString, Min, Max, MinLength } from 'class-validator';

export class TestConnectionDto {
  @IsString()
  @IsNotEmpty({ message: 'Server address is required' })
  serverAddress!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsString()
  @IsNotEmpty({ message: 'Manager login ID is required' })
  managerLogin!: string;

  @IsString()
  @IsNotEmpty({ message: 'Manager password is required' })
  @MinLength(4)
  password!: string;
}

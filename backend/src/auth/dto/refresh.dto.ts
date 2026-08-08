import { IsNotEmpty } from 'class-validator';

export class RefreshDto {
  @IsNotEmpty({ message: 'Refresh token is required' })
  refreshToken!: string;
}

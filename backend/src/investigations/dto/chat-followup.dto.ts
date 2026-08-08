import { IsNotEmpty, IsString, IsArray, IsOptional, ValidateNested } from 'class-validator';

export class ChatMessageDto {
  @IsString()
  @IsNotEmpty()
  role!: 'user' | 'assistant';

  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class ChatFollowupDto {
  @IsString()
  @IsNotEmpty({ message: 'User question message is required' })
  message!: string;

  @IsOptional()
  @IsArray()
  chatHistory?: ChatMessageDto[];
}

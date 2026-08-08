import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateNoteDto {
  @IsString()
  @IsNotEmpty({ message: 'Note content is required' })
  @MinLength(3, { message: 'Note content must be at least 3 characters long' })
  content!: string;
}

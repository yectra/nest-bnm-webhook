import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AskAgentDto {
  /** Natural-language question, answered across documents and business data. */
  @IsString()
  @IsNotEmpty()
  question: string;

  /** Optional conversation thread id for multi-turn context. */
  @IsString()
  @IsOptional()
  threadId?: string;
}

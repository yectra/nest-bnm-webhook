import { IsOptional, IsString } from 'class-validator';

export class HelloAgentDto {
  @IsOptional()
  @IsString()
  message?: string;
}

import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class EmbeddingPreviewDto {
  /** Text used to verify the Azure OpenAI embedding deployment. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(32000)
  text: string;
}

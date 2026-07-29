import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ChatMessageDto {
  @ApiProperty({
    description: 'User prompt or message text',
    example: 'Tell me about Modular Kitchen',
  })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional({
    description: 'Unique conversation or session identifier',
    example: 'session-12345',
  })
  @IsString()
  @IsOptional()
  sessionId?: string;

  @ApiPropertyOptional({
    description: 'Unique conversation identifier (alias for sessionId)',
    example: 'conv-12345',
  })
  @IsString()
  @IsOptional()
  conversationId?: string;

  @ApiPropertyOptional({
    description: 'Authenticated or anonymous user ID',
    example: 'user-789',
  })
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Source channel of the message',
    enum: ['Website', 'Teams'],
    default: 'Website',
  })
  @IsIn(['Website', 'Teams'])
  @IsOptional()
  channel?: 'Website' | 'Teams';

  @ApiPropertyOptional({
    description: 'Optional tenant identifier',
  })
  @IsString()
  @IsOptional()
  tenantId?: string;
}

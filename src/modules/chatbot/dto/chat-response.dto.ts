import { ApiProperty } from '@nestjs/swagger';

export class ChatResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'Here is the details about Modular Kitchen...' })
  response!: string;

  @ApiProperty({ example: 'conv-12345' })
  conversationId!: string;

  @ApiProperty({ example: 'session-12345' })
  sessionId!: string;

  @ApiProperty({ example: 'user-789' })
  userId!: string;

  @ApiProperty({ example: 'Website', enum: ['Website', 'Teams'] })
  channel!: 'Website' | 'Teams';

  @ApiProperty({ example: '2026-07-29T15:54:01.000Z' })
  timestamp!: string;

  @ApiProperty({
    example: {
      totalMatches: 3,
      matchedDocuments: [],
    },
  })
  meta?: Record<string, unknown>;
}

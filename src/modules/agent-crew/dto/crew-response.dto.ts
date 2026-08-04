import { ApiProperty } from '@nestjs/swagger';
import type {
  CrewDispatchResult,
  CrewPlan,
  CrewTraceEntry,
} from '../interfaces/crew.interfaces';

export class CrewResponseMetaDto {
  @ApiProperty({ description: 'Supervisor plan for this run' })
  plan!: CrewPlan;

  @ApiProperty({ description: 'Number of service vector matches used' })
  serviceMatches!: number;

  @ApiProperty({ description: 'Number of quote records used' })
  quoteMatches!: number;

  @ApiProperty({ description: 'Number of attached pictures analyzed' })
  imagesAnalyzed!: number;

  @ApiProperty({
    description: 'PII categories redacted from the answer',
    type: [String],
  })
  piiRedactions!: string[];

  @ApiProperty({ description: 'Teams / WebSocket delivery outcome' })
  dispatch!: CrewDispatchResult;

  @ApiProperty({ description: 'Per-agent execution trace' })
  trace!: CrewTraceEntry[];
}

export class CrewResponseDto {
  @ApiProperty()
  success!: boolean;

  @ApiProperty({ description: 'PII-filtered crew answer' })
  response!: string;

  @ApiProperty()
  conversationId!: string;

  @ApiProperty()
  sessionId!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ enum: ['Website', 'Teams'] })
  channel!: 'Website' | 'Teams';

  @ApiProperty()
  timestamp!: string;

  @ApiProperty({ type: CrewResponseMetaDto })
  meta!: CrewResponseMetaDto;
}

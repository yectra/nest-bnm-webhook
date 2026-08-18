import { Injectable, Logger } from '@nestjs/common';

import { AzureLogService } from './azure-log.service';
import { RequirementsAgentService } from './requirements-agent.service';
import { qualifyRequirementsEvent } from './requirements-event.qualifier';
import type {
  QualifiableEvent,
  RequirementsAgentResult,
  RequirementsQualification,
} from '../interfaces/requirements-event.interface';

export interface WhatsappAgentEventOutcome {
  qualified: boolean;
  reason: string;
  eventId?: string;
  result?: RequirementsAgentResult;
}

const QUALIFY_CATEGORY = 'whatsapp-agent.qualification';
const RESULT_CATEGORY = 'whatsapp-agent.requirements-result';

/**
 * Entry point from the Event Grid handler: qualifies the event, branches to
 * the "Post Your Requirements" deep agent when it matches, and writes the
 * qualification and the agent result to the Azure application log.
 */
@Injectable()
export class WhatsappAgentEventService {
  private readonly logger = new Logger(WhatsappAgentEventService.name);

  constructor(
    private readonly requirementsAgentService: RequirementsAgentService,
    private readonly azureLogService: AzureLogService,
  ) {}

  /** Qualify only — synchronous, so the webhook can shape its response. */
  qualify(event: QualifiableEvent): RequirementsQualification {
    return qualifyRequirementsEvent(event);
  }

  /**
   * Run the agent branch for an already-qualified event and log the outcome.
   * Never throws: Event Grid retries on failure, and a retry would only repeat
   * the same agent error.
   */
  async handleQualified(
    qualification: RequirementsQualification,
  ): Promise<WhatsappAgentEventOutcome> {
    this.azureLogService.log(QUALIFY_CATEGORY, {
      qualified: true,
      reason: qualification.reason,
      matchedOn: qualification.matchedOn,
      eventId: qualification.eventId,
      eventType: qualification.eventType,
      conversationId: qualification.conversationId,
      userId: qualification.userId,
      messagePreview: qualification.message.slice(0, 200),
    });

    try {
      const result = await this.requirementsAgentService.run(qualification);

      this.azureLogService.log(RESULT_CATEGORY, {
        eventId: qualification.eventId,
        eventType: qualification.eventType,
        conversationId: qualification.conversationId,
        userId: qualification.userId,
        model: result.model,
        degraded: result.degraded,
        durationMs: result.durationMs,
        customerNamesRequested: result.customerNamesRequested,
        customerNameCount: result.customerNames.length,
        customerNames: result.customerNames,
        langsmithProject: result.traceProject,
        langsmithRunId: result.traceRunId,
        answer: result.answer,
      });

      return {
        qualified: true,
        reason: qualification.reason,
        eventId: qualification.eventId,
        result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Post Your Requirements agent failed for event ${qualification.eventId}: ${message}`,
      );
      this.azureLogService.error(RESULT_CATEGORY, {
        eventId: qualification.eventId,
        eventType: qualification.eventType,
        conversationId: qualification.conversationId,
        failed: true,
        error: message,
      });
      return {
        qualified: true,
        reason: qualification.reason,
        eventId: qualification.eventId,
      };
    }
  }

  /** Qualify and, when it matches, run the agent. Logs both verdicts. */
  async handleEvent(
    event: QualifiableEvent,
  ): Promise<WhatsappAgentEventOutcome> {
    const qualification = this.qualify(event);
    if (!qualification.qualified) {
      this.azureLogService.log(QUALIFY_CATEGORY, {
        qualified: false,
        reason: qualification.reason,
        eventId: qualification.eventId,
        eventType: qualification.eventType,
      });
      return {
        qualified: false,
        reason: qualification.reason,
        eventId: qualification.eventId,
      };
    }
    return this.handleQualified(qualification);
  }

  /**
   * Fire-and-forget variant for the Event Grid delivery path, which must be
   * acknowledged quickly. The result lands in the Azure log, not the response.
   */
  handleQualifiedInBackground(qualification: RequirementsQualification): void {
    void this.handleQualified(qualification).catch((error) => {
      this.logger.error(
        `Unhandled requirements agent failure: ${String(error)}`,
      );
    });
  }
}

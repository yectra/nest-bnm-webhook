import { Module, OnModuleInit } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { AdversaryVectorStoreService } from './services/adversary-vector-store.service';
import { AdversaryLlmReviewService } from './services/adversary-llm-review.service';
import { AdversaryGuardService } from './services/adversary-guard.service';

/**
 * Standalone adversary (prompt-injection) guard. Import this module from any
 * workflow that consumes untrusted text and inject AdversaryGuardService —
 * the WhatsApp crew uses it as a graph node today; the website/Teams crew or
 * any future subagent can call inspect() the same way. All consumers share
 * one Cosmos vector container of known-attack exemplars, so an attack
 * learned in one workflow protects all of them.
 */
@Module({
  imports: [ChatbotModule],
  providers: [
    AdversaryVectorStoreService,
    AdversaryLlmReviewService,
    AdversaryGuardService,
  ],
  exports: [AdversaryGuardService, AdversaryVectorStoreService],
})
export class AdversaryGuardModule implements OnModuleInit {
  constructor(private readonly vectorStore: AdversaryVectorStoreService) {}

  onModuleInit() {
    // Fire and forget: container creation + exemplar seeding must never
    // block application startup.
    void this.vectorStore.ensureSeeded();
  }
}

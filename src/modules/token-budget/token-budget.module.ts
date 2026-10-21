import { Global, Module } from '@nestjs/common';
import { CosmosModule } from '../database/cosmos.module';
import { TokenBudgetRepository } from './token-budget.repository';
import { TokenBudgetService } from './token-budget.service';
import { WhatsAppSenderPolicyService } from './whatsapp-sender-policy.service';

@Global()
@Module({
  imports: [CosmosModule],
  providers: [
    TokenBudgetRepository,
    TokenBudgetService,
    WhatsAppSenderPolicyService,
  ],
  exports: [
    TokenBudgetRepository,
    TokenBudgetService,
    WhatsAppSenderPolicyService,
  ],
})
export class TokenBudgetModule {}

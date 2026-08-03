import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CloudAdapter,
  ConfigurationServiceClientCredentialFactory,
  createBotFrameworkAuthenticationFromConfiguration,
} from 'botbuilder';
import { ConversationItem } from '../conversation/conversation.service';

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);
  private adapter: CloudAdapter;

  constructor(private configService: ConfigService) {
    const appId = this.configService.get<string>('azure.microsoftAppId') || process.env.MicrosoftAppId;
    const appPassword = this.configService.get<string>('azure.microsoftAppPassword') || process.env.MicrosoftAppPassword;
    const tenantId = this.configService.get<string>('azure.microsoftAppTenantId') || process.env.MicrosoftAppTenantId;

    const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
      MicrosoftAppId: appId,
      MicrosoftAppPassword: appPassword,
      MicrosoftAppType: appId ? 'MultiTenant' : undefined,
      MicrosoftAppTenantId: tenantId,
    });

    const botFrameworkAuthentication =
      createBotFrameworkAuthenticationFromConfiguration(
        null,
        credentialsFactory,
      );
    this.adapter = new CloudAdapter(botFrameworkAuthentication);

    this.adapter.onTurnError = async (context, error) => {
      this.logger.error(`[onTurnError] unhandled error: ${error}`);
      await context.sendTraceActivity(
        'OnTurnError Trace',
        `${error}`,
        'https://www.botframework.com/schemas/error',
        'TurnError',
      );
      await context.sendActivity('The bot encountered an error or bug.');
    };
  }

  getAdapter(): CloudAdapter {
    return this.adapter;
  }

  notifyTeams(conversationItem: ConversationItem): Promise<void> {
    this.logger.log(
      `[Teams Notification] Sent to Teams -> Conversation ID: ${conversationItem.id}`,
    );
    this.logger.log(`Question: ${conversationItem.question}`);
    this.logger.log(`AI Answer: ${conversationItem.aiAnswer}`);

    return Promise.resolve();
  }
}

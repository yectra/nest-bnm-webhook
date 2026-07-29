import { Injectable } from '@nestjs/common';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
} from 'botbuilder';

@Injectable()
export class BotAdapter extends CloudAdapter {
  constructor() {
    console.log('APP ID:', process.env.MICROSOFT_APP_ID);
    console.log('TENANT:', process.env.MICROSOFT_APP_TENANT_ID);
    console.log('PASSWORD EXISTS:', !!process.env.MICROSOFT_APP_PASSWORD);
    const botFrameworkAuthentication =
      new ConfigurationBotFrameworkAuthentication({
        MicrosoftAppId: process.env.MICROSOFT_APP_ID!,
        MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD!,
        MicrosoftAppTenantId: process.env.MICROSOFT_APP_TENANT_ID!,
        MicrosoftAppType: 'SingleTenant',
      });

    super(botFrameworkAuthentication);

    this.onTurnError = async (context, error) => {
      console.error(error);

      await context.sendActivity('Sorry, something went wrong.');
    };
  }
}

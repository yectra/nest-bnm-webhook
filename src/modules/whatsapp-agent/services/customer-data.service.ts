import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CosmosService } from '../../database/cosmos.service';

export interface CustomerRecord {
  id: string;
  phoneNumber?: string;
  name?: string;
  role?: string;
}

export interface ContentRecord {
  id: string;
  phoneNumber?: string;
  renderedMessage?: string;
  type?: string;
  createdDate?: string; // "dd-MMM-yyyy HH:mm"
}

/** Accept the stored variants of the sender's number only. */
export function phoneVariants(phone: string): string[] {
  const bare = phone.replace(/^\+/, '');
  return [...new Set([phone, `+${bare}`, bare, `whatsapp:+${bare}`])];
}

/**
 * Read-only access to the business containers used to ground the agent.
 * Every query is scoped to the exact phone number passed in (the verified
 * sender), never to model- or user-supplied values. Failures degrade to
 * empty results so the agent answers "I don't have that information"
 * instead of erroring.
 */
@Injectable()
export class CustomerDataService {
  private readonly logger = new Logger(CustomerDataService.name);

  constructor(
    private readonly cosmosService: CosmosService,
    private readonly configService: ConfigService,
  ) {}

  async lookupCustomer(phone: string): Promise<CustomerRecord[]> {
    try {
      const container = this.cosmosService.getContainer(
        this.configService.get<string>('whatsappAgent.containers.user') ||
          'User',
      );
      const { resources } = await container.items
        .query<CustomerRecord>({
          query:
            'SELECT c.id, c.phoneNumber, c.name, c.role FROM c WHERE ARRAY_CONTAINS(@variants, c.phoneNumber)',
          parameters: [{ name: '@variants', value: phoneVariants(phone) }],
        })
        .fetchAll();
      return resources;
    } catch (error) {
      this.logger.warn(`lookupCustomer failed: ${String(error)}`);
      return [];
    }
  }

  async recentContent(phone: string, limit: number): Promise<ContentRecord[]> {
    try {
      const container = this.cosmosService.getContainer(
        this.configService.get<string>('whatsappAgent.containers.content') ||
          'WhatsAppContent',
      );
      // createdDate ("dd-MMM-yyyy HH:mm") does not sort as a string, so
      // fetch a window and let the caller order by parsed timestamp.
      const { resources } = await container.items
        .query<ContentRecord>({
          query:
            'SELECT TOP @window c.id, c.phoneNumber, c.renderedMessage, c.type, c.createdDate FROM c WHERE ARRAY_CONTAINS(@variants, c.phoneNumber)',
          parameters: [
            { name: '@variants', value: phoneVariants(phone) },
            { name: '@window', value: Math.max(limit * 10, 50) },
          ],
        })
        .fetchAll();
      return resources;
    } catch (error) {
      this.logger.warn(`recentContent failed: ${String(error)}`);
      return [];
    }
  }
}

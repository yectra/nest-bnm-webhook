import { ConfigService } from '@nestjs/config';
import { CosmosService } from '../../database/cosmos.service';
import { CustomerFeedbackService } from './customer-feedback.service';

function configWith(feedbackContainer?: string): ConfigService {
  return {
    get: (key: string) =>
      key === 'whatsappAgent.feedbackContainer' ? feedbackContainer : undefined,
  } as unknown as ConfigService;
}

function cosmosReturning(resources: number[]) {
  const capture = { container: '', query: '' };
  const cosmosService = {
    getContainer: (name: string) => {
      capture.container = name;
      return {
        items: {
          query: (query: string) => {
            capture.query = query;
            return { fetchAll: () => Promise.resolve({ resources }) };
          },
        },
      };
    },
  } as unknown as CosmosService;
  return { cosmosService, capture };
}

describe('CustomerFeedbackService', () => {
  it('counts items in the configured container', async () => {
    const { cosmosService, capture } = cosmosReturning([42]);
    const service = new CustomerFeedbackService(
      cosmosService,
      configWith('MyFeedback'),
    );
    await expect(service.countFeedbackItems()).resolves.toBe(42);
    expect(capture.container).toBe('MyFeedback');
    expect(capture.query).toBe('SELECT VALUE COUNT(1) FROM c');
  });

  it('defaults to the CustomerFeedback container when not configured', async () => {
    const { cosmosService, capture } = cosmosReturning([3]);
    const service = new CustomerFeedbackService(cosmosService, configWith());
    await expect(service.countFeedbackItems()).resolves.toBe(3);
    expect(capture.container).toBe('CustomerFeedback');
  });

  it('returns 0 when the query yields no rows', async () => {
    const { cosmosService } = cosmosReturning([]);
    const service = new CustomerFeedbackService(cosmosService, configWith());
    await expect(service.countFeedbackItems()).resolves.toBe(0);
  });

  it('propagates Cosmos failures to the caller', async () => {
    const cosmosService = {
      getContainer: () => {
        throw new Error('cosmos outage');
      },
    } as unknown as CosmosService;
    const service = new CustomerFeedbackService(cosmosService, configWith());
    await expect(service.countFeedbackItems()).rejects.toThrow('cosmos outage');
  });
});

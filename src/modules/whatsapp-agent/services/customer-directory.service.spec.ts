import { ConfigService } from '@nestjs/config';
import { CustomerDirectoryService } from './customer-directory.service';
import { CosmosService } from '../../database/cosmos.service';

function build(
  fetchAll: () => Promise<{ resources: Record<string, unknown>[] }>,
  captureQuery?: (query: string) => void,
) {
  const cosmosService = {
    getContainer: () => ({
      items: {
        query: (query: string) => {
          captureQuery?.(query);
          return { fetchAll };
        },
      },
    }),
  } as unknown as CosmosService;

  const configService = {
    get: (key: string) =>
      key === 'whatsappAgent.requirements.container'
        ? 'PostYourRequirements'
        : key === 'whatsappAgent.requirements.maxCustomers'
          ? 200
          : undefined,
  } as unknown as ConfigService;

  return new CustomerDirectoryService(cosmosService, configService);
}

describe('CustomerDirectoryService', () => {
  it('reads names from the documented fields and de-duplicates them', async () => {
    const service = build(() =>
      Promise.resolve({
        resources: [
          { id: '1', customerName: 'Asha Menon' },
          { id: '2', contactName: 'Ravi Kumar' },
          { id: '3', firstName: 'Lila', lastName: 'Nair' },
          { id: '4', customer: { name: 'Sam Ali' } },
          { id: '5', customerName: 'asha menon' },
          { id: '6' },
        ],
      }),
    );

    const result = await service.listCustomerNames();

    expect(result.names).toEqual([
      'Asha Menon',
      'Ravi Kumar',
      'Lila Nair',
      'Sam Ali',
    ]);
    expect(result.scanned).toBe(6);
    expect(result.container).toBe('PostYourRequirements');
    expect(result.error).toBeUndefined();
  });

  it('clamps the limit to a safe integer instead of interpolating it raw', async () => {
    const queries: string[] = [];
    const service = build(
      () => Promise.resolve({ resources: [] }),
      (query) => queries.push(query),
    );

    await service.listCustomerNames(10);
    await service.listCustomerNames(99999);
    await service.listCustomerNames(-1);

    expect(queries[0]).toContain('SELECT TOP 10 ');
    // Both the oversized and the nonsensical bound fall back to the cap.
    expect(queries[1]).toContain('SELECT TOP 200 ');
    expect(queries[2]).toContain('SELECT TOP 1 ');
    expect(queries.every((query) => /^SELECT TOP \d+ /.test(query))).toBe(true);
  });

  it('degrades to an empty list when Cosmos fails', async () => {
    const service = build(() =>
      Promise.reject(new Error('cosmos unreachable')),
    );

    await expect(service.listCustomerNames()).resolves.toEqual({
      names: [],
      scanned: 0,
      container: 'PostYourRequirements',
      error: 'cosmos unreachable',
    });
  });
});

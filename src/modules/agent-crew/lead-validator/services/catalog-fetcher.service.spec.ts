import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  CatalogFetcherService,
  FALLBACK_CATALOG_SERVICES,
} from './catalog-fetcher.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CatalogFetcherService', () => {
  let service: CatalogFetcherService;
  let mockConfig: jest.Mocked<ConfigService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'BNM_CATALOG_SERVICE_URL') {
          return 'https://bnm-api-dev.azure-api.net/bnm-service/service';
        }
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    service = new CatalogFetcherService(mockConfig);
  });

  it('should fetch and parse catalog items from live API', async () => {
    const mockData = [
      {
        id: 'mock-1',
        name: 'Mock Service',
        category: { name: 'Mock Category' },
        description: 'Mock Description',
        keyFeatures: ['Feature 1', 'Feature 2'],
      },
    ];

    mockedAxios.get.mockResolvedValueOnce({ data: mockData });

    const result = await service.fetchCatalog();
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('mock-1');
    expect(result[0].name).toBe('Mock Service');
  });

  it('should use in-memory cache on second fetch within TTL', async () => {
    const mockData = [
      {
        id: 'mock-1',
        name: 'Mock Service',
      },
    ];

    mockedAxios.get.mockResolvedValueOnce({ data: mockData });

    const first = await service.fetchCatalog();
    const second = await service.fetchCatalog();

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('should fall back to FALLBACK_CATALOG_SERVICES when API call fails', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await service.fetchCatalog();
    expect(result).toEqual(FALLBACK_CATALOG_SERVICES);
    expect(result.length).toBe(19);
  });

  it('should format catalog correctly for prompt injection', () => {
    const sample = [
      {
        id: 'id-100',
        name: 'Water Proofing',
        category: { name: 'Water Proofing' },
        description: 'Complete building waterproofing',
        keyFeatures: ['Terrace', 'Basement'],
      },
    ];

    const formatted = service.formatCatalogForPrompt(sample);
    expect(formatted).toContain('[Service 1] ID: "id-100"');
    expect(formatted).toContain('Name: "Water Proofing"');
    expect(formatted).toContain('Category: "Water Proofing"');
    expect(formatted).toContain('Description: Complete building waterproofing');
    expect(formatted).toContain('Key Features: Terrace, Basement');
  });
});

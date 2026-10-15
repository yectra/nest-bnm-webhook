/* eslint-disable @typescript-eslint/unbound-method */
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  CatalogFetcherService,
  FALLBACK_CATALOG_SERVICES,
} from './catalog-fetcher.service';
import { ConsulHttpClientService } from '../../../../modules/consul/consul-http-client.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CatalogFetcherService', () => {
  let service: CatalogFetcherService;
  let mockConfig: jest.Mocked<ConfigService>;
  let mockConsulHttpClient: jest.Mocked<ConsulHttpClientService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'BNM_CATALOG_SERVICE_URL') {
          return 'https://bnm-api-dev.azure-api.net/bnm-service/service';
        }
        if (key === 'BNM_CATALOG_SERVICE_NAME') {
          return 'bnm-service';
        }
        if (key === 'BNM_CATALOG_SERVICE_PATH') {
          return '/service';
        }
        if (key === 'CONSUL_ENABLED') {
          return true;
        }
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    mockConsulHttpClient = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConsulHttpClientService>;

    service = new CatalogFetcherService(mockConfig, mockConsulHttpClient);
  });

  it('should fetch catalog items dynamically via Consul service discovery when enabled', async () => {
    const mockDiscoveredCatalog = [
      {
        id: 'java-svc-1',
        name: 'Dynamic Construction Service',
        category: { name: 'Construction' },
        description: 'Discovered via Consul from Java microservice',
        keyFeatures: ['Feature A', 'Feature B'],
      },
    ];

    mockConsulHttpClient.get.mockResolvedValueOnce(mockDiscoveredCatalog);

    const result = await service.fetchCatalog();

    expect(mockConsulHttpClient.get).toHaveBeenCalledTimes(1);
    expect(mockConsulHttpClient.get).toHaveBeenCalledWith(
      'bnm-service',
      '/service',
    );
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('java-svc-1');
    expect(result[0].name).toBe('Dynamic Construction Service');
  });

  it('should fall back to static API endpoint when Consul discovery finds no healthy instances', async () => {
    mockConsulHttpClient.get.mockRejectedValueOnce(
      new Error('No healthy instances found for bnm-service'),
    );

    const mockAxiosData = [
      {
        id: 'static-1',
        name: 'Static Endpoint Service',
        category: { name: 'Static Category' },
        description: 'Fetched from static fallback endpoint',
        keyFeatures: ['Feature X'],
      },
    ];

    mockedAxios.get.mockResolvedValueOnce({ data: mockAxiosData });

    const result = await service.fetchCatalog();

    expect(mockConsulHttpClient.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('static-1');
  });

  it('should fall back to static API when Consul call returns empty array', async () => {
    mockConsulHttpClient.get.mockResolvedValueOnce([]);

    const mockAxiosData = [
      {
        id: 'static-2',
        name: 'Fallback Service',
      },
    ];

    mockedAxios.get.mockResolvedValueOnce({ data: mockAxiosData });

    const result = await service.fetchCatalog();

    expect(mockConsulHttpClient.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('static-2');
  });

  it('should use in-memory cache on second fetch within TTL without re-querying Consul', async () => {
    const mockData = [
      {
        id: 'mock-1',
        name: 'Cached Service',
      },
    ];

    mockConsulHttpClient.get.mockResolvedValueOnce(mockData);

    const first = await service.fetchCatalog();
    const second = await service.fetchCatalog();

    expect(mockConsulHttpClient.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(first).toBe(second);
  });

  it('should fall back to FALLBACK_CATALOG_SERVICES when both Consul and static API fail', async () => {
    mockConsulHttpClient.get.mockRejectedValueOnce(
      new Error('Consul cluster down'),
    );
    mockedAxios.get.mockRejectedValueOnce(new Error('Static endpoint timeout'));

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

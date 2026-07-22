import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ClientSecretCredential,
  DefaultAzureCredential,
  TokenCredential,
} from '@azure/identity';
import axios, { AxiosInstance, isAxiosError } from 'axios';

/**
 * Queries the Fabric IQ ontology/graph built over the mirrored BNM business data
 * (Epic A / A5).
 *
 * Acquires an Entra bearer token (scope
 * `https://analysis.windows.net/powerbi/api/.default`) and POSTs to the Fabric
 * GraphQL API and the Graph model (GQL) `executeQuery` endpoint. Workspace / API
 * / model ids come from `ConfigService`; the service-principal secret is resolved
 * via `@azure/identity` and never committed.
 */
@Injectable()
export class FabricIqService {
  private readonly logger = new Logger(FabricIqService.name);

  private readonly credential: TokenCredential;
  private readonly scope: string;
  private readonly workspaceId?: string;
  private readonly graphqlApiId?: string;
  private readonly graphModelId?: string;
  private readonly http: AxiosInstance;

  /** Refresh the token this many milliseconds before it actually expires. */
  private static readonly EXPIRY_SKEW_MS = 5 * 60 * 1000;

  private cachedToken?: string;
  private cachedTokenExpiresAt = 0;

  constructor(private readonly configService: ConfigService) {
    const tenantId = this.configService.get<string>('fabric.tenantId');
    const clientId = this.configService.get<string>('fabric.clientId');
    const clientSecret = this.configService.get<string>('fabric.clientSecret');
    this.scope = this.configService.get<string>('fabric.scope')!;
    this.workspaceId = this.configService.get<string>('fabric.workspaceId');
    this.graphqlApiId = this.configService.get<string>('fabric.graphqlApiId');
    this.graphModelId = this.configService.get<string>('fabric.graphModelId');
    const baseUrl = this.configService.get<string>('fabric.baseUrl')!;

    if (tenantId && clientId && clientSecret) {
      this.credential = new ClientSecretCredential(
        tenantId,
        clientId,
        clientSecret,
      );
      this.logger.log('Fabric auth: ClientSecretCredential (app registration)');
    } else {
      this.credential = new DefaultAzureCredential();
      this.logger.log('Fabric auth: DefaultAzureCredential (managed identity)');
    }

    this.http = axios.create({ baseURL: baseUrl });
    this.http.interceptors.request.use(async (config) => {
      const token = await this.getAccessToken();
      config.headers.set('Authorization', `Bearer ${token}`);
      return config;
    });
  }

  /** Acquire a bearer token for the Fabric scope, cached until near expiry. */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.cachedTokenExpiresAt) {
      return this.cachedToken;
    }

    const result = await this.credential.getToken(this.scope);
    if (!result) {
      throw new Error('Failed to acquire Microsoft Fabric access token');
    }

    this.cachedToken = result.token;
    this.cachedTokenExpiresAt =
      result.expiresOnTimestamp - FabricIqService.EXPIRY_SKEW_MS;
    return this.cachedToken;
  }

  /**
   * Run a GraphQL query against the Fabric GraphQL API over the mirrored data.
   *
   * POST `/workspaces/{workspaceId}/graphqlapis/{graphqlApiId}/graphql`
   */
  async queryGraphQL<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const workspaceId = this.require(this.workspaceId, 'FABRIC_WORKSPACE_ID');
    const apiId = this.require(this.graphqlApiId, 'FABRIC_GRAPHQL_API_ID');

    return this.post<T>(
      `/workspaces/${workspaceId}/graphqlapis/${apiId}/graphql`,
      { query, variables },
      'GraphQL',
    );
  }

  /**
   * Execute a graph (GQL) query against a Fabric Graph model.
   *
   * POST `/workspaces/{workspaceId}/GraphModels/{graphModelId}/executeQuery?preview=true`
   */
  async executeGraphQuery<T = unknown>(
    query: string,
    parameters?: Record<string, unknown>,
  ): Promise<T> {
    const workspaceId = this.require(this.workspaceId, 'FABRIC_WORKSPACE_ID');
    const modelId = this.require(this.graphModelId, 'FABRIC_GRAPH_MODEL_ID');

    return this.post<T>(
      `/workspaces/${workspaceId}/GraphModels/${modelId}/executeQuery?preview=true`,
      parameters ? { query, parameters } : { query },
      'Graph GQL',
    );
  }

  private async post<T>(url: string, body: unknown, label: string): Promise<T> {
    try {
      const { data } = await this.http.post<T>(url, body);
      return data;
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      this.logger.error(
        `Fabric ${label} query failed${status ? ` (HTTP ${status})` : ''}`,
        error,
      );
      throw new InternalServerErrorException(`Fabric ${label} query failed`);
    }
  }

  private require(value: string | undefined, envName: string): string {
    if (!value) {
      throw new ServiceUnavailableException(
        `Fabric IQ is not configured: ${envName} is missing`,
      );
    }
    return value;
  }
}

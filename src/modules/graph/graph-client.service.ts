import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ClientSecretCredential,
  DefaultAzureCredential,
  TokenCredential,
} from '@azure/identity';
import axios, { AxiosInstance } from 'axios';

/**
 * Shared Microsoft Graph client (Epic B / B1).
 *
 * Builds an Entra credential — `ClientSecretCredential` when an app
 * registration (tenant/client/secret) is configured, otherwise
 * `DefaultAzureCredential` (managed identity) — acquires and caches a bearer
 * token for the Graph scope, and exposes a pre-configured Axios client that
 * injects that token per request. SharePoint-specific logic lives in the
 * `SharePointDocService` (B2), which injects this service.
 */
@Injectable()
export class GraphClientService {
  private readonly logger = new Logger(GraphClientService.name);

  private readonly credential: TokenCredential;
  private readonly scope: string;
  private readonly http: AxiosInstance;

  /** Refresh the token this many milliseconds before it actually expires. */
  private static readonly EXPIRY_SKEW_MS = 5 * 60 * 1000;

  private cachedToken?: string;
  private cachedTokenExpiresAt = 0;

  constructor(private readonly configService: ConfigService) {
    const tenantId = this.configService.get<string>('microsoftGraph.tenantId');
    const clientId = this.configService.get<string>('microsoftGraph.clientId');
    const clientSecret = this.configService.get<string>(
      'microsoftGraph.clientSecret',
    );
    this.scope = this.configService.get<string>('microsoftGraph.scope')!;
    const baseUrl = this.configService.get<string>('microsoftGraph.baseUrl')!;

    if (tenantId && clientId && clientSecret) {
      this.credential = new ClientSecretCredential(
        tenantId,
        clientId,
        clientSecret,
      );
      this.logger.log('Graph auth: ClientSecretCredential (app registration)');
    } else {
      this.credential = new DefaultAzureCredential();
      this.logger.log('Graph auth: DefaultAzureCredential (managed identity)');
    }

    this.http = axios.create({ baseURL: baseUrl });
    this.http.interceptors.request.use(async (config) => {
      const token = await this.getAccessToken();
      config.headers.set('Authorization', `Bearer ${token}`);
      return config;
    });
  }

  /**
   * Acquire a bearer token for the Graph scope, cached until shortly before it
   * expires.
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.cachedTokenExpiresAt) {
      return this.cachedToken;
    }

    const result = await this.credential.getToken(this.scope);
    if (!result) {
      throw new Error('Failed to acquire Microsoft Graph access token');
    }

    this.cachedToken = result.token;
    this.cachedTokenExpiresAt =
      result.expiresOnTimestamp - GraphClientService.EXPIRY_SKEW_MS;
    return this.cachedToken;
  }

  /**
   * Axios client pre-configured with the Graph base URL and per-request bearer
   * token injection. Use this for all Graph REST calls.
   */
  getHttpClient(): AxiosInstance {
    return this.http;
  }
}

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

import { SharePointDocService } from '../sharepoint/sharepoint-doc.service';
import { SharePointDoc } from '../sharepoint/interfaces/sharepoint-doc.interface';
import { FoundryAgentAnswer } from './interfaces/foundry-agent-answer.interface';

/**
 * Calls the Foundry IQ agent's REST endpoint (Epic B / B3).
 *
 * The agent is grounded, in the Foundry portal, on the unified knowledge base:
 * SharePoint documents (B2) and the Fabric IQ ontology over the mirrored business
 * data (A5). So a single question can be answered across both planes. This
 * service acquires an Entra bearer token, posts the question, and resolves any
 * SharePoint document citations to full metadata via {@link SharePointDocService}.
 */
@Injectable()
export class FoundryIqAgentService {
  private readonly logger = new Logger(FoundryIqAgentService.name);

  private readonly credential: TokenCredential;
  private readonly scope: string;
  private readonly endpoint?: string;
  private readonly apiVersion?: string;
  private readonly http: AxiosInstance;

  /** Refresh the token this many milliseconds before it actually expires. */
  private static readonly EXPIRY_SKEW_MS = 5 * 60 * 1000;

  /** Cap on citations resolved to SharePoint metadata per answer. */
  private static readonly MAX_CITATIONS = 5;

  private cachedToken?: string;
  private cachedTokenExpiresAt = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly sharePointDocService: SharePointDocService,
  ) {
    const tenantId = this.configService.get<string>('foundry.tenantId');
    const clientId = this.configService.get<string>('foundry.clientId');
    const clientSecret = this.configService.get<string>('foundry.clientSecret');
    this.scope = this.configService.get<string>('foundry.scope')!;
    this.endpoint = this.configService.get<string>('foundry.endpoint');
    this.apiVersion = this.configService.get<string>('foundry.apiVersion');

    if (tenantId && clientId && clientSecret) {
      this.credential = new ClientSecretCredential(
        tenantId,
        clientId,
        clientSecret,
      );
      this.logger.log(
        'Foundry auth: ClientSecretCredential (app registration)',
      );
    } else {
      this.credential = new DefaultAzureCredential();
      this.logger.log(
        'Foundry auth: DefaultAzureCredential (managed identity)',
      );
    }

    this.http = axios.create();
    this.http.interceptors.request.use(async (config) => {
      const token = await this.getAccessToken();
      config.headers.set('Authorization', `Bearer ${token}`);
      return config;
    });
  }

  /** Acquire a bearer token for the Foundry scope, cached until near expiry. */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.cachedTokenExpiresAt) {
      return this.cachedToken;
    }

    const result = await this.credential.getToken(this.scope);
    if (!result) {
      throw new Error('Failed to acquire Foundry agent access token');
    }

    this.cachedToken = result.token;
    this.cachedTokenExpiresAt =
      result.expiresOnTimestamp - FoundryIqAgentService.EXPIRY_SKEW_MS;
    return this.cachedToken;
  }

  /**
   * Ask the grounded agent a question.
   *
   * @param question natural-language question (spans documents and business data).
   * @param threadId optional conversation thread id for multi-turn context.
   */
  async ask(question: string, threadId?: string): Promise<FoundryAgentAnswer> {
    if (!this.endpoint) {
      throw new ServiceUnavailableException(
        'Foundry IQ is not configured: FOUNDRY_AGENT_ENDPOINT is missing',
      );
    }

    let raw: unknown;
    try {
      const response = await this.http.post(
        this.endpoint,
        { question, threadId },
        this.apiVersion
          ? { params: { 'api-version': this.apiVersion } }
          : undefined,
      );
      raw = response.data;
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      this.logger.error(
        `Foundry agent request failed${status ? ` (HTTP ${status})` : ''}`,
        error,
      );
      throw new InternalServerErrorException('Foundry agent request failed');
    }

    const answer = this.extractAnswer(raw);
    const documents = await this.resolveCitations(raw);
    return { answer, documents, raw };
  }

  /** Best-effort extraction of the answer text from common agent payload shapes. */
  private extractAnswer(raw: unknown): string {
    if (typeof raw === 'string') {
      return raw;
    }
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      for (const key of ['answer', 'output', 'content', 'text']) {
        if (typeof obj[key] === 'string') {
          return obj[key];
        }
      }
    }
    return '';
  }

  /**
   * Resolve document citations in the agent payload to full SharePoint metadata
   * via {@link SharePointDocService}. Defensive over unknown payload shapes:
   * returns an empty list when no citations are present.
   */
  private async resolveCitations(raw: unknown): Promise<SharePointDoc[]> {
    const queries = this.extractCitationQueries(raw);
    if (queries.length === 0) {
      return [];
    }

    const resolved = await Promise.all(
      queries.slice(0, FoundryIqAgentService.MAX_CITATIONS).map((q) =>
        this.sharePointDocService
          .search(q, 1)
          .then((docs) => docs[0])
          .catch((error) => {
            this.logger.warn(`Failed to resolve citation "${q}"`, error);
            return undefined;
          }),
      ),
    );

    return resolved.filter((doc): doc is SharePointDoc => Boolean(doc));
  }

  /** Pull citation reference strings (file names / titles) from common shapes. */
  private extractCitationQueries(raw: unknown): string[] {
    if (!raw || typeof raw !== 'object') {
      return [];
    }
    const obj = raw as Record<string, unknown>;
    const list = obj.citations ?? obj.references ?? obj.sources;
    if (!Array.isArray(list)) {
      return [];
    }

    const queries: string[] = [];
    for (const item of list) {
      if (typeof item === 'string') {
        queries.push(item);
      } else if (item && typeof item === 'object') {
        const ref = item as Record<string, unknown>;
        const value = ref.name ?? ref.title ?? ref.fileName ?? ref.filename;
        if (typeof value === 'string') {
          queries.push(value);
        }
      }
    }
    return queries;
  }
}

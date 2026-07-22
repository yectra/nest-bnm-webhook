import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isAxiosError } from 'axios';

import { GraphClientService } from '../graph/graph-client.service';
import { SharePointDoc } from './interfaces/sharepoint-doc.interface';

/** Minimal shape of the Microsoft Graph `/search/query` response we consume. */
interface GraphSearchResponse {
  value?: Array<{
    hitsContainers?: Array<{
      hits?: Array<{
        hitId?: string;
        summary?: string;
        resource?: {
          id?: string;
          name?: string;
          webUrl?: string;
          size?: number;
          lastModifiedDateTime?: string;
          parentReference?: { driveId?: string };
        };
      }>;
    }>;
  }>;
}

interface GraphDriveItem {
  id?: string;
  name?: string;
  webUrl?: string;
  size?: number;
  lastModifiedDateTime?: string;
  parentReference?: { driveId?: string };
}

/**
 * Search and retrieve SharePoint documents via Microsoft Graph (Epic B / B2).
 *
 * Uses the shared {@link GraphClientService} (B1) for authenticated calls. This
 * is the SharePoint/Graph document plane that will be contributed as a knowledge
 * source to the Foundry IQ knowledge base in B3.
 */
@Injectable()
export class SharePointDocService {
  private readonly logger = new Logger(SharePointDocService.name);

  private static readonly DEFAULT_TOP = 25;

  constructor(private readonly graphClient: GraphClientService) {}

  /**
   * Full-text search across SharePoint documents (driveItems).
   *
   * @param query free-text query.
   * @param top max results (default 25).
   */
  async search(query: string, top?: number): Promise<SharePointDoc[]> {
    const size = top ?? SharePointDocService.DEFAULT_TOP;
    try {
      const { data } = await this.graphClient
        .getHttpClient()
        .post<GraphSearchResponse>('/search/query', {
          requests: [
            {
              entityTypes: ['driveItem'],
              query: { queryString: query },
              from: 0,
              size,
            },
          ],
        });

      const hits = data.value?.[0]?.hitsContainers?.[0]?.hits ?? [];
      return hits.map((hit) => {
        const resource = hit.resource ?? {};
        return {
          id: resource.id ?? hit.hitId ?? '',
          name: resource.name ?? '',
          webUrl: resource.webUrl,
          size: resource.size,
          lastModifiedDateTime: resource.lastModifiedDateTime,
          summary: hit.summary,
          driveId: resource.parentReference?.driveId,
        };
      });
    } catch (error) {
      this.logger.error('SharePoint document search failed', error);
      throw new InternalServerErrorException(
        'SharePoint document search failed',
      );
    }
  }

  /**
   * Retrieve a single SharePoint document's metadata by drive and item id.
   *
   * @param driveId owning drive id.
   * @param itemId driveItem id.
   */
  async getDoc(driveId: string, itemId: string): Promise<SharePointDoc> {
    try {
      const { data } = await this.graphClient
        .getHttpClient()
        .get<GraphDriveItem>(
          `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`,
        );

      return {
        id: data.id ?? itemId,
        name: data.name ?? '',
        webUrl: data.webUrl,
        size: data.size,
        lastModifiedDateTime: data.lastModifiedDateTime,
        driveId: data.parentReference?.driveId ?? driveId,
      };
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        throw new NotFoundException('SharePoint document not found');
      }
      this.logger.error('SharePoint document retrieval failed', error);
      throw new InternalServerErrorException(
        'SharePoint document retrieval failed',
      );
    }
  }
}

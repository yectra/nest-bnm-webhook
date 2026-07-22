import { SharePointDoc } from '../../sharepoint/interfaces/sharepoint-doc.interface';

/**
 * A grounded answer from the Foundry IQ agent (Epic B / B3).
 *
 * The agent grounds server-side on the unified knowledge base (SharePoint docs +
 * Fabric IQ ontology). `documents` are SharePoint citations resolved to full
 * metadata via B2's `SharePointDocService`; `raw` is the untouched agent payload
 * for callers that need more.
 */
export interface FoundryAgentAnswer {
  answer: string;
  documents: SharePointDoc[];
  raw: unknown;
}

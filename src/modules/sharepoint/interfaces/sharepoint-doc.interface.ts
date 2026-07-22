/** A SharePoint document (driveItem) surfaced via Microsoft Graph search (B2). */
export interface SharePointDoc {
  /** Graph driveItem id. */
  id: string;
  /** File name. */
  name: string;
  /** Browser URL to open the document. */
  webUrl?: string;
  /** Size in bytes. */
  size?: number;
  /** Last modified timestamp (ISO 8601). */
  lastModifiedDateTime?: string;
  /** Search snippet/summary for the hit. */
  summary?: string;
  /** Owning drive id, when available. */
  driveId?: string;
}

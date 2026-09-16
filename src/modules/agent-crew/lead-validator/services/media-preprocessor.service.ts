import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import axios from 'axios';
import sharp from 'sharp';
import { PDFParse } from 'pdf-parse';

export interface ProcessedAttachmentsResult {
  appendedText: string;
  processedImages: string[];
}

@Injectable()
export class MediaPreprocessorService {
  private readonly logger = new Logger(MediaPreprocessorService.name);

  private readonly documentExtensions = new Set(['.pdf', '.txt', '.docx']);
  private readonly convertibleImageExtensions = new Set([
    '.avif',
    '.heic',
    '.bmp',
  ]);
  private readonly supportedImageExtensions = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
  ]);
  private readonly audioExtensions = new Set([
    '.ogg',
    '.mp3',
    '.wav',
    '.m4a',
    '.aac',
    '.flac',
    '.opus',
    '.oga',
  ]);

  /**
   * Main entry point to process attachments.
   * Extracts text from documents (.pdf, .txt), converts non-standard images (.avif, .heic, .bmp)
   * to JPEG base64 Data URLs, encodes private/inaccessible images to base64 Data URLs,
   * and skips audio files gracefully with an explicit warning.
   */
  async processAttachments(
    mediaUrls?: string[],
  ): Promise<ProcessedAttachmentsResult> {
    if (!mediaUrls || !Array.isArray(mediaUrls) || mediaUrls.length === 0) {
      return { appendedText: '', processedImages: [] };
    }

    const documentTexts: string[] = [];
    const processedImages: string[] = [];

    for (const url of mediaUrls) {
      if (!url || typeof url !== 'string' || url.trim().length === 0) {
        continue;
      }

      const trimmedUrl = url.trim();

      // Check audio files first to avoid unnecessary download bandwidth
      if (this.isAudio(trimmedUrl)) {
        this.logger.warn(
          `[MediaPreprocessor] Audio file detected (${trimmedUrl}), but no audio model is configured. Skipping audio transcription.`,
        );
        continue;
      }

      try {
        if (this.isDocument(trimmedUrl)) {
          const text = await this.processDocument(trimmedUrl);
          if (text) {
            documentTexts.push(text);
          }
        } else if (this.isImage(trimmedUrl)) {
          const imageResult = await this.processImage(trimmedUrl);
          if (imageResult) {
            processedImages.push(imageResult);
          }
        } else {
          // If extension not obvious from URL, download and inspect content-type
          await this.processUnknownMedia(
            trimmedUrl,
            documentTexts,
            processedImages,
          );
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[MediaPreprocessor] Failed to process attachment (${trimmedUrl}): ${message}`,
        );
      }
    }

    return {
      appendedText: documentTexts.filter(Boolean).join('\n\n'),
      processedImages,
    };
  }

  /**
   * Process a document attachment (.pdf, .txt, .docx).
   */
  private async processDocument(url: string): Promise<string | null> {
    const ext = this.getExtension(url);
    const buffer = await this.downloadBuffer(url);

    if (ext === '.pdf') {
      const text = await this.extractPdfText(buffer);
      return text ? `[PDF Document Content]:\n${text}` : null;
    }

    if (ext === '.txt') {
      const text = buffer.toString('utf-8').trim();
      return text ? `[Text Document Content]:\n${text}` : null;
    }

    if (ext === '.docx') {
      // Graceful fallback for docx
      this.logger.log(
        `[MediaPreprocessor] Received .docx attachment (${url}).`,
      );
      return `[Attached DOCX Document: ${path.basename(url.split('?')[0])}]`;
    }

    return null;
  }

  /**
   * Extracts text from a PDF Buffer safely using pdf-parse.
   */
  public async extractPdfText(buffer: Buffer): Promise<string> {
    try {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return result?.text?.trim() || '';
      } finally {
        await parser.destroy().catch(() => {});
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to parse PDF document: ${message}`);
    }
    return '';
  }

  /**
   * Process an image attachment (.jpg, .jpeg, .png, .webp, .avif, .heic, .bmp).
   */
  private async processImage(url: string): Promise<string | null> {
    // Already a base64 data URL
    if (url.startsWith('data:image/')) {
      return url;
    }

    const ext = this.getExtension(url);
    const buffer = await this.downloadBuffer(url);

    // Convert .avif, .heic, .bmp to JPEG base64 Data URL
    if (this.convertibleImageExtensions.has(ext)) {
      const jpegBuffer = await sharp(buffer).jpeg({ quality: 85 }).toBuffer();
      return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
    }

    // Supported formats (.jpg, .jpeg, .png, .webp)
    if (this.supportedImageExtensions.has(ext)) {
      const isPublic = await this.isPubliclyAccessible(url);
      if (isPublic) {
        return url;
      }

      // Convert private / inaccessible blob to base64 Data URL so Azure OpenAI vision does not throw 400/403
      const mimeType = this.getMimeType(ext);
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    }

    return null;
  }

  /**
   * Handle attachments whose extension could not be determined from the URL path.
   */
  private async processUnknownMedia(
    url: string,
    documentTexts: string[],
    processedImages: string[],
  ): Promise<void> {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
    });

    const rawContentType = response.headers['content-type'];
    const contentType =
      typeof rawContentType === 'string' ? rawContentType.toLowerCase() : '';
    const buffer = Buffer.from(response.data);

    if (contentType.startsWith('audio/')) {
      this.logger.warn(
        `[MediaPreprocessor] Audio file detected (${url}), but no audio model is configured. Skipping audio transcription.`,
      );
      return;
    }

    if (contentType.includes('pdf')) {
      const text = await this.extractPdfText(buffer);
      if (text) {
        documentTexts.push(`[PDF Document Content]:\n${text}`);
      }
      return;
    }

    if (contentType.includes('text/plain')) {
      const text = buffer.toString('utf-8').trim();
      if (text) {
        documentTexts.push(`[Text Document Content]:\n${text}`);
      }
      return;
    }

    if (contentType.startsWith('image/')) {
      if (
        contentType.includes('avif') ||
        contentType.includes('heic') ||
        contentType.includes('heif') ||
        contentType.includes('bmp')
      ) {
        const jpegBuffer = await sharp(buffer).jpeg({ quality: 85 }).toBuffer();
        processedImages.push(
          `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`,
        );
      } else {
        const isPublic = await this.isPubliclyAccessible(url);
        if (isPublic) {
          processedImages.push(url);
        } else {
          processedImages.push(
            `data:${contentType};base64,${buffer.toString('base64')}`,
          );
        }
      }
    }
  }

  /**
   * Checks whether the given image URL is accessible publicly by Azure OpenAI without authentication.
   */
  public async isPubliclyAccessible(url: string): Promise<boolean> {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();

      // Check for private / internal addresses
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host.startsWith('192.168.') ||
        host.startsWith('10.') ||
        host.endsWith('.internal') ||
        host.endsWith('.local')
      ) {
        return false;
      }

      // Check for WhatsApp / Facebook Graph API endpoints that require Bearer tokens
      if (host.includes('graph.facebook.com') || host.includes('fbcdn.net')) {
        return false;
      }

      // Test with an unauthenticated HEAD request
      const response = await axios.head(url, {
        timeout: 3000,
        validateStatus: (status) => status === 200,
      });

      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Download a remote URL into a Buffer.
   */
  public async downloadBuffer(url: string): Promise<Buffer> {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
    });
    return Buffer.from(response.data);
  }

  private isAudio(url: string): boolean {
    const ext = this.getExtension(url);
    return this.audioExtensions.has(ext);
  }

  private isDocument(url: string): boolean {
    const ext = this.getExtension(url);
    return this.documentExtensions.has(ext);
  }

  private isImage(url: string): boolean {
    if (url.startsWith('data:image/')) {
      return true;
    }
    const ext = this.getExtension(url);
    return (
      this.convertibleImageExtensions.has(ext) ||
      this.supportedImageExtensions.has(ext)
    );
  }

  private getExtension(url: string): string {
    try {
      const parsed = new URL(url);
      const ext = path.extname(parsed.pathname).toLowerCase();
      if (ext) return ext;
    } catch {
      // Fallback if not standard URL
    }
    const clean = url.split('?')[0].split('#')[0];
    const match = clean.match(/\.([a-z0-9]+)$/i);
    return match ? `.${match[1].toLowerCase()}` : '';
  }

  private getMimeType(ext: string): string {
    switch (ext) {
      case '.png':
        return 'image/png';
      case '.webp':
        return 'image/webp';
      case '.jpg':
      case '.jpeg':
      default:
        return 'image/jpeg';
    }
  }
}

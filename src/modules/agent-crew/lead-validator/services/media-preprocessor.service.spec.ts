import { MediaPreprocessorService } from './media-preprocessor.service';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import sharp from 'sharp';

jest.mock('axios');
jest.mock('sharp');

describe('MediaPreprocessorService', () => {
  let service: MediaPreprocessorService;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new MediaPreprocessorService();
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('processAttachments', () => {
    it('should return empty results if mediaUrls is empty or undefined', async () => {
      const res1 = await service.processAttachments();
      expect(res1).toEqual({ appendedText: '', processedImages: [] });

      const res2 = await service.processAttachments([]);
      expect(res2).toEqual({ appendedText: '', processedImages: [] });
    });

    describe('Documents', () => {
      it('should extract text from .txt files as UTF-8 string', async () => {
        const textContent = 'Detailed requirements for painting the 2BHK flat.';
        const buffer = Buffer.from(textContent, 'utf-8');

        (axios.get as jest.Mock).mockResolvedValueOnce({
          data: buffer,
          headers: { 'content-type': 'text/plain' },
        });

        const result = await service.processAttachments([
          'https://example.com/notes.txt',
        ]);

        expect(result.appendedText).toContain(
          '[Text Document Content]:\nDetailed requirements for painting the 2BHK flat.',
        );
        expect(result.processedImages).toHaveLength(0);
      });

      it('should extract text from .pdf files using extractPdfText', async () => {
        const pdfText = 'Architectural specification: 1200 sqft floor plan.';
        jest.spyOn(service, 'extractPdfText').mockResolvedValueOnce(pdfText);
        jest
          .spyOn(service, 'downloadBuffer')
          .mockResolvedValueOnce(Buffer.from('%PDF-1.4...'));

        const result = await service.processAttachments([
          'https://example.com/plan.pdf',
        ]);

        expect(result.appendedText).toContain(
          '[PDF Document Content]:\nArchitectural specification: 1200 sqft floor plan.',
        );
        expect(result.processedImages).toHaveLength(0);
      });

      it('should handle .docx files gracefully with a descriptor note', async () => {
        jest
          .spyOn(service, 'downloadBuffer')
          .mockResolvedValueOnce(Buffer.from('docx binary data'));

        const result = await service.processAttachments([
          'https://example.com/specs.docx',
        ]);

        expect(result.appendedText).toContain(
          '[Attached DOCX Document: specs.docx]',
        );
        expect(result.processedImages).toHaveLength(0);
      });
    });

    describe('Images', () => {
      it('should convert .heic, .avif, and .bmp to JPEG base64 Data URLs using sharp', async () => {
        const rawBuffer = Buffer.from('fake-heic-data');
        const convertedJpegBuffer = Buffer.from('fake-jpeg-data');

        jest.spyOn(service, 'downloadBuffer').mockResolvedValue(rawBuffer);

        const mockToBuffer = jest.fn().mockResolvedValue(convertedJpegBuffer);
        const mockJpeg = jest.fn().mockReturnValue({ toBuffer: mockToBuffer });
        (sharp as unknown as jest.Mock).mockReturnValue({ jpeg: mockJpeg });

        const result = await service.processAttachments([
          'https://example.com/photo.heic',
        ]);

        expect(sharp).toHaveBeenCalledWith(rawBuffer);
        expect(mockJpeg).toHaveBeenCalledWith({ quality: 85 });
        expect(result.processedImages).toEqual([
          `data:image/jpeg;base64,${convertedJpegBuffer.toString('base64')}`,
        ]);
        expect(result.appendedText).toBe('');
      });

      it('should pass publicly accessible standard images directly', async () => {
        const url = 'https://example.com/drawing.jpg';
        jest
          .spyOn(service, 'downloadBuffer')
          .mockResolvedValue(Buffer.from('jpg-data'));
        jest.spyOn(service, 'isPubliclyAccessible').mockResolvedValue(true);

        const result = await service.processAttachments([url]);

        expect(result.processedImages).toEqual([url]);
        expect(result.appendedText).toBe('');
      });

      it('should convert private or inaccessible standard images to base64 Data URLs', async () => {
        const url = 'https://internal-blob.core.windows.net/leads/private.png';
        const pngBuffer = Buffer.from('png-binary-data');

        jest.spyOn(service, 'downloadBuffer').mockResolvedValue(pngBuffer);
        jest.spyOn(service, 'isPubliclyAccessible').mockResolvedValue(false);

        const result = await service.processAttachments([url]);

        expect(result.processedImages).toEqual([
          `data:image/png;base64,${pngBuffer.toString('base64')}`,
        ]);
      });

      it('should pass already base64 data URLs without re-downloading', async () => {
        const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
        const downloadSpy = jest.spyOn(service, 'downloadBuffer');

        const result = await service.processAttachments([dataUrl]);

        expect(downloadSpy).not.toHaveBeenCalled();
        expect(result.processedImages).toEqual([dataUrl]);
      });
    });

    describe('Audio / Voice Notes', () => {
      it('should log an explicit warning and skip audio transcription without crashing', async () => {
        const audioUrl = 'https://example.com/voicenote.ogg';
        const downloadSpy = jest.spyOn(service, 'downloadBuffer');

        const result = await service.processAttachments([audioUrl]);

        expect(loggerWarnSpy).toHaveBeenCalledWith(
          `[MediaPreprocessor] Audio file detected (${audioUrl}), but no audio model is configured. Skipping audio transcription.`,
        );
        expect(downloadSpy).not.toHaveBeenCalled();
        expect(result.appendedText).toBe('');
        expect(result.processedImages).toHaveLength(0);
      });

      it('should support other audio formats (.mp3, .wav, .m4a)', async () => {
        const audioUrls = [
          'https://example.com/audio.mp3',
          'https://example.com/audio.wav',
          'https://example.com/audio.m4a',
        ];

        const result = await service.processAttachments(audioUrls);

        expect(loggerWarnSpy).toHaveBeenCalledTimes(3);
        expect(result.appendedText).toBe('');
        expect(result.processedImages).toHaveLength(0);
      });
    });

    describe('Error Resilience', () => {
      it('should handle network failures gracefully without failing the batch', async () => {
        jest
          .spyOn(service, 'downloadBuffer')
          .mockRejectedValueOnce(new Error('ETIMEDOUT'));

        const result = await service.processAttachments([
          'https://example.com/timeout.pdf',
        ]);

        expect(loggerWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Failed to process attachment'),
        );
        expect(result.appendedText).toBe('');
        expect(result.processedImages).toHaveLength(0);
      });
    });
  });

  describe('isPubliclyAccessible', () => {
    it('should return false for localhost and internal IPs', async () => {
      expect(
        await service.isPubliclyAccessible('http://localhost:3000/image.jpg'),
      ).toBe(false);
      expect(
        await service.isPubliclyAccessible('http://127.0.0.1/image.jpg'),
      ).toBe(false);
      expect(
        await service.isPubliclyAccessible('http://192.168.1.10/image.jpg'),
      ).toBe(false);
      expect(
        await service.isPubliclyAccessible('http://10.0.0.5/image.jpg'),
      ).toBe(false);
      expect(
        await service.isPubliclyAccessible(
          'http://api.corp.internal/image.jpg',
        ),
      ).toBe(false);
    });

    it('should return false for authenticated Facebook/WhatsApp media domains', async () => {
      expect(
        await service.isPubliclyAccessible(
          'https://lookaside.fbsbx.com/whatsapp_business/attachments/123.jpg',
        ),
      ).toBe(false);
      expect(
        await service.isPubliclyAccessible(
          'https://graph.facebook.com/v20.0/media/123.jpg',
        ),
      ).toBe(false);
    });

    it('should return true if unauthenticated HEAD succeeds with 200', async () => {
      (axios.head as jest.Mock).mockResolvedValueOnce({ status: 200 });

      const isPublic = await service.isPubliclyAccessible(
        'https://public-cdn.com/sample.jpg',
      );
      expect(isPublic).toBe(true);
    });

    it('should return false if unauthenticated HEAD throws or returns error status', async () => {
      (axios.head as jest.Mock).mockRejectedValueOnce(
        new Error('403 Forbidden'),
      );

      const isPublic = await service.isPubliclyAccessible(
        'https://private-blob.azure.com/sample.jpg',
      );
      expect(isPublic).toBe(false);
    });
  });
});

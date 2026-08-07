import { TwilioMessageParserService } from './twilio-message-parser.service';

describe('TwilioMessageParserService', () => {
  let parser: TwilioMessageParserService;

  const base = {
    MessageSid: 'SM123',
    AccountSid: 'AC123',
    From: 'whatsapp:+15551234567',
    To: 'whatsapp:+15557654321',
    WaId: '15551234567',
    ProfileName: 'Asha',
  };

  beforeEach(() => {
    parser = new TwilioMessageParserService();
  });

  it('parses a plain text message', () => {
    const message = parser.parse({ ...base, Body: 'Status of my quote?' });
    expect(message.messageType).toBe('text');
    expect(message.body).toBe('Status of my quote?');
    expect(message.from).toBe('whatsapp:+15551234567');
    expect(message.waId).toBe('15551234567');
  });

  it('trusts the declared MessageType when present', () => {
    const message = parser.parse({
      ...base,
      MessageType: 'reaction',
      Body: '👍',
    });
    expect(message.messageType).toBe('reaction');
  });

  it('parses an image message with media', () => {
    const message = parser.parse({
      ...base,
      Body: 'Leaky pipe',
      NumMedia: '1',
      MediaUrl0: 'https://api.twilio.com/media/1',
      MediaContentType0: 'image/jpeg',
    });
    expect(message.messageType).toBe('image');
    expect(message.media).toHaveLength(1);
    expect(message.media[0]).toEqual({
      index: 0,
      url: 'https://api.twilio.com/media/1',
      contentType: 'image/jpeg',
    });
  });

  it('classifies webp media as a sticker', () => {
    const message = parser.parse({
      ...base,
      NumMedia: '1',
      MediaUrl0: 'https://api.twilio.com/media/2',
      MediaContentType0: 'image/webp',
    });
    expect(message.messageType).toBe('sticker');
  });

  it('parses video, audio, vcard, and document media types', () => {
    const cases: [string, string][] = [
      ['video/mp4', 'video'],
      ['audio/ogg', 'audio'],
      ['text/vcard', 'contacts'],
      ['application/pdf', 'document'],
    ];
    for (const [contentType, expected] of cases) {
      const message = parser.parse({
        ...base,
        NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/media/3',
        MediaContentType0: contentType,
      });
      expect(message.messageType).toBe(expected);
    }
  });

  it('parses multiple media items', () => {
    const message = parser.parse({
      ...base,
      NumMedia: '2',
      MediaUrl0: 'https://api.twilio.com/media/a',
      MediaContentType0: 'image/png',
      MediaUrl1: 'https://api.twilio.com/media/b',
      MediaContentType1: 'image/jpeg',
    });
    expect(message.numMedia).toBe(2);
    expect(message.media).toHaveLength(2);
  });

  it('parses a shared location', () => {
    const message = parser.parse({
      ...base,
      Latitude: '12.9716',
      Longitude: '77.5946',
      Address: 'MG Road, Bengaluru',
      Label: 'Home',
    });
    expect(message.messageType).toBe('location');
    expect(message.location).toEqual({
      latitude: 12.9716,
      longitude: 77.5946,
      label: 'Home',
      address: 'MG Road, Bengaluru',
    });
  });

  it('parses a button reply', () => {
    const message = parser.parse({
      ...base,
      Body: 'Yes, approve',
      ButtonText: 'Yes, approve',
      ButtonPayload: 'approve_quote',
    });
    expect(message.messageType).toBe('button');
    expect(message.buttonPayload).toBe('approve_quote');
  });

  it('parses an interactive list reply', () => {
    const message = parser.parse({
      ...base,
      ListId: 'svc_painting',
      ListTitle: 'Painting service',
    });
    expect(message.messageType).toBe('interactive');
    expect(message.interactiveReply).toEqual({
      id: 'svc_painting',
      title: 'Painting service',
    });
  });

  it('falls back to unknown for an empty payload shape', () => {
    const message = parser.parse({ ...base });
    expect(message.messageType).toBe('unknown');
  });
});

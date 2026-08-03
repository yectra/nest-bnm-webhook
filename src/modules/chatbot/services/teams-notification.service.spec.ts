import { TeamsNotificationService } from './teams-notification.service';

describe('TeamsNotificationService', () => {
  it('prefers a replyToId mapping when present', () => {
    const service = new TeamsNotificationService({} as any, {} as any);
    service['messageToWebsiteMap'].set('reply-123', 'website-abc');

    const result = service.resolveWebsiteConversationId({
      replyToId: 'reply-123',
      teamsConversationId: 'teams-1',
      fallbackConversationId: 'website-fallback',
    });

    expect(result).toBe('website-abc');
  });

  it('uses the Teams conversation mapping as a fallback', () => {
    const service = new TeamsNotificationService({} as any, {} as any);
    service.registerConversationLink('teams-1', 'website-xyz');

    const result = service.resolveWebsiteConversationId({
      teamsConversationId: 'teams-1',
      fallbackConversationId: 'website-fallback',
    });

    expect(result).toBe('website-xyz');
  });

  it('handles semicolon-separated replyToId strings', () => {
    const service = new TeamsNotificationService({} as any, {} as any);
    service['messageToWebsiteMap'].set('reply-456', 'website-semi');

    const result = service.resolveWebsiteConversationId({
      replyToId: 'reply-456;messageid=reply-456',
      teamsConversationId: 'teams-1',
      fallbackConversationId: 'website-fallback',
    });

    expect(result).toBe('website-semi');
  });

  it('falls back to the active website conversation id', () => {
    const service = new TeamsNotificationService({} as any, {} as any);
    service.setActiveWebsiteConversationId('website-active');

    const result = service.resolveWebsiteConversationId({
      teamsConversationId: 'teams-2',
      fallbackConversationId: 'website-fallback',
    });

    expect(result).toBe('website-active');
  });
});

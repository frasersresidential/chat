import { BaseAdapter } from './base.js';

/**
 * Mock channel for local development & demos. Lets you simulate inbound
 * customer messages through POST /webhooks/mock without any external platform,
 * exercising the full routing + inbox pipeline end to end.
 *
 * Inbound payload:
 *   { accountId, participantId, participantName, text }
 */
export class MockAdapter extends BaseAdapter {
  constructor() {
    super('mock');
  }

  resolveAccountId(body) {
    return body.accountId || null;
  }

  parseInbound(body, _account) {
    return [{
      participantId: body.participantId || `guest_${Date.now()}`,
      participantName: body.participantName || 'Mock Customer',
      text: body.text || '',
      vip: !!body.vip, // lets you exercise VIP/priority routing locally
      attachments: [],
      externalMessageId: `mock_${Date.now()}`,
      timestamp: new Date().toISOString(),
    }];
  }

  async deliver(_account, conversation, text) {
    this.log.info(`[mock] reply to ${conversation.customer?.name}: ${text}`);
    return `mock_out_${Date.now()}`;
  }
}

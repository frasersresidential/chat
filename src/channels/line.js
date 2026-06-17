import crypto from 'node:crypto';
import { BaseAdapter } from './base.js';

/**
 * LINE Official Account — Messaging API.
 * One organization typically connects several LINE OAs (e.g. Brand A, Brand B,
 * After-Sales); each is a separate ChannelAccount keyed by its bot `userId`
 * which arrives as `destination` on every webhook.
 */
export class LineAdapter extends BaseAdapter {
  constructor() {
    super('line');
  }

  resolveAccountId(body) {
    return body?.destination || null;
  }

  verifySignature(raw, headers, account) {
    const secret = account?.credential?.channelSecret;
    if (!secret) return true;
    const sig = headers['x-line-signature'];
    if (!sig) return false;
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('base64');
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  parseInbound(body, _account) {
    const out = [];
    for (const ev of body.events || []) {
      if (ev.type !== 'message' || ev.message?.type !== 'text') continue;
      out.push({
        participantId: ev.source?.userId,
        participantName: null, // resolve via profile API if needed
        text: ev.message.text,
        attachments: [],
        externalMessageId: ev.message.id,
        replyToken: ev.replyToken,
        timestamp: ev.timestamp ? new Date(ev.timestamp).toISOString() : new Date().toISOString(),
      });
    }
    return out;
  }

  async deliver(account, conversation, text) {
    const token = account.credential.accessToken;
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        to: conversation.participantId,
        messages: [{ type: 'text', text }],
      }),
    });
    if (!res.ok) throw new Error(`LINE API ${res.status}: ${await res.text()}`);
    return res.headers.get('x-line-request-id') || `line_${Date.now()}`;
  }
}

import crypto from 'node:crypto';
import { BaseAdapter } from './base.js';

/**
 * TikTok — Business Messaging.
 * Webhook events are signed; inbound DMs map to a normalized message. Delivery
 * goes through the TikTok Business API. (TikTok's messaging API access is
 * gated; this adapter follows the documented event shape and gracefully
 * simulates when no token is configured.)
 */
export class TikTokAdapter extends BaseAdapter {
  constructor() {
    super('tiktok');
  }

  resolveAccountId(body) {
    return body?.event?.receiver_id || body?.client_key || null;
  }

  verifySignature(raw, headers, account) {
    const secret = account?.credential?.clientSecret;
    if (!secret) return true;
    const sig = headers['x-tiktok-signature'];
    if (!sig) return false;
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  parseInbound(body, _account) {
    const events = body.events || (body.event ? [body.event] : []);
    return events
      .filter((ev) => ev.type === 'message' || ev.event === 'message')
      .map((ev) => ({
        participantId: ev.sender_id || ev.from_user_id,
        participantName: ev.sender_name || null,
        text: ev.content?.text || ev.message?.text || '',
        attachments: [],
        externalMessageId: ev.message_id || ev.id,
        timestamp: ev.create_time
          ? new Date(Number(ev.create_time) * 1000).toISOString()
          : new Date().toISOString(),
      }));
  }

  async deliver(account, conversation, text) {
    const token = account.credential.accessToken;
    const res = await fetch('https://business-api.tiktok.com/open_api/v1.3/im/message/send/', {
      method: 'POST',
      headers: {
        'Access-Token': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        to_user_id: conversation.participantId,
        message: { type: 'text', text },
      }),
    });
    if (!res.ok) throw new Error(`TikTok API ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.data?.message_id || `tiktok_${Date.now()}`;
  }
}

import crypto from 'node:crypto';
import { BaseAdapter } from './base.js';

/**
 * X (Twitter) Direct Messages via the Account Activity API.
 * Account Activity uses a CRC challenge for subscription and an
 * X-Twitter-Webhooks-Signature header per delivery.
 */
export class XAdapter extends BaseAdapter {
  constructor() {
    super('x');
  }

  resolveAccountId(body) {
    return body?.for_user_id || null;
  }

  /** Answer the CRC token challenge GET request. */
  verifyChallenge(query, account) {
    const crc = query.crc_token;
    const secret = account?.credential?.apiSecret;
    if (!crc || !secret) return null;
    const hash = crypto.createHmac('sha256', secret).update(crc).digest('base64');
    return JSON.stringify({ response_token: `sha256=${hash}` });
  }

  verifySignature(raw, headers, account) {
    const secret = account?.credential?.apiSecret;
    if (!secret) return true;
    const sig = headers['x-twitter-webhooks-signature'];
    if (!sig) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('base64');
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  parseInbound(body, account) {
    const out = [];
    const selfId = account?.accountId;
    for (const ev of body.direct_message_events || []) {
      if (ev.type !== 'message_create') continue;
      const senderId = ev.message_create?.sender_id;
      if (senderId === selfId) continue; // ignore our own echoes
      out.push({
        participantId: senderId,
        participantName: null,
        text: ev.message_create?.message_data?.text || '',
        attachments: [],
        externalMessageId: ev.id,
        timestamp: ev.created_timestamp
          ? new Date(Number(ev.created_timestamp)).toISOString()
          : new Date().toISOString(),
      });
    }
    return out;
  }

  async deliver(account, conversation, text) {
    const token = account.credential.accessToken;
    const res = await fetch('https://api.twitter.com/2/dm_conversations/with/' +
      `${conversation.participantId}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`X API ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.data?.dm_event_id || `x_${Date.now()}`;
  }
}

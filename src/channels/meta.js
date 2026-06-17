import crypto from 'node:crypto';
import { BaseAdapter } from './base.js';

/**
 * Shared base for Meta's Messenger Platform family (Facebook Messenger,
 * Instagram Messaging, WhatsApp Cloud API). They share webhook verification
 * (hub challenge + X-Hub-Signature-256) and Graph API delivery.
 */
export class MetaAdapter extends BaseAdapter {
  resolveAccountId(body) {
    return body?.entry?.[0]?.id || null;
  }

  verifyChallenge(query, account) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    if (mode === 'subscribe' && token && token === account?.credential?.verifyToken) {
      return query['hub.challenge'];
    }
    return null;
  }

  verifySignature(raw, headers, account) {
    const secret = account?.credential?.appSecret;
    if (!secret) return true; // unsigned / simulated account
    const sig = headers['x-hub-signature-256'];
    if (!sig) return false;
    const expected =
      'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  parseInbound(body, _account) {
    const out = [];
    for (const entry of body.entry || []) {
      for (const ev of entry.messaging || []) {
        if (!ev.message || ev.message.is_echo) continue;
        out.push({
          participantId: ev.sender?.id,
          participantName: ev.sender?.name || null,
          text: ev.message.text || '',
          attachments: ev.message.attachments || [],
          externalMessageId: ev.message.mid,
          timestamp: ev.timestamp ? new Date(ev.timestamp).toISOString() : new Date().toISOString(),
        });
      }
    }
    return out;
  }

  async deliver(account, conversation, text) {
    const token = account.credential.accessToken;
    const res = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: conversation.participantId },
        message: { text },
        messaging_type: 'RESPONSE',
      }),
    });
    if (!res.ok) throw new Error(`Graph API ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.message_id;
  }
}

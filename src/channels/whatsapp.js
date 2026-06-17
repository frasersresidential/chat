import crypto from 'node:crypto';
import { BaseAdapter } from './base.js';

/**
 * WhatsApp Business — Meta Cloud API.
 * Webhook verification matches the Messenger family, but the inbound payload
 * and the send endpoint differ (messages live under entry[].changes[].value).
 */
export class WhatsAppAdapter extends BaseAdapter {
  constructor() {
    super('whatsapp');
  }

  resolveAccountId(body) {
    // The WABA phone_number_id identifies which connected account this is.
    return body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id || null;
  }

  verifyChallenge(query, account) {
    if (
      query['hub.mode'] === 'subscribe' &&
      query['hub.verify_token'] === account?.credential?.verifyToken
    ) {
      return query['hub.challenge'];
    }
    return null;
  }

  verifySignature(raw, headers, account) {
    const secret = account?.credential?.appSecret;
    if (!secret) return true;
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
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const contacts = value.contacts || [];
        for (const msg of value.messages || []) {
          const contact = contacts.find((c) => c.wa_id === msg.from);
          out.push({
            participantId: msg.from,
            participantName: contact?.profile?.name || null,
            text: msg.text?.body || '',
            attachments: [],
            externalMessageId: msg.id,
            timestamp: msg.timestamp
              ? new Date(Number(msg.timestamp) * 1000).toISOString()
              : new Date().toISOString(),
          });
        }
      }
    }
    return out;
  }

  async deliver(account, conversation, text) {
    const { accessToken, phoneNumberId } = account.credential;
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: conversation.participantId,
        type: 'text',
        text: { body: text },
      }),
    });
    if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.messages?.[0]?.id;
  }
}

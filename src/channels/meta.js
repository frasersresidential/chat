import crypto from 'node:crypto';
import { BaseAdapter } from './base.js';

/**
 * Normalize a Messenger `referral` object (present on Click-to-Messenger ads
 * and m.me links). Real ads only give us `ad_id` + `ads_context_data`; the Ad
 * name / Ad set name are resolved later via the Graph API (see core/ads.js).
 * `ad_name`/`adset_name` are accepted too so the simulator can inject them.
 */
/**
 * Parse a `ref` string into UTM-style fields. Supports query-string encoding
 * (`utm_source=fb&utm_campaign=summer`, also `|`/`;` separated). Falls back to
 * the raw value so any custom ref (e.g. "summer_promo") is still tracked.
 */
function parseUtm(ref) {
  if (!ref) return null;
  if (/=/.test(ref)) {
    const p = {};
    for (const part of ref.split(/[&|;]/)) {
      const [k, v] = part.split('=');
      if (k && v) p[k.trim().toLowerCase()] = decodeURIComponent(v.trim());
    }
    return {
      source: p.utm_source || null, medium: p.utm_medium || null,
      campaign: p.utm_campaign || null, content: p.utm_content || null,
      term: p.utm_term || null, raw: ref,
    };
  }
  return { raw: ref };
}

function parseReferral(r) {
  if (!r || (r.source !== 'ADS' && !r.ad_id && !r.ref)) return null;
  const ctx = r.ads_context_data || {};
  return {
    source: r.source || null,
    type: r.type || null,
    ref: r.ref || null,
    utm: parseUtm(r.ref),
    adId: r.ad_id || null,
    adTitle: ctx.ad_title || null,
    adName: r.ad_name || ctx.ad_name || null,
    adsetName: r.adset_name || ctx.adset_name || null,
    campaignName: r.campaign_name || ctx.campaign_name || null,
  };
}

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
          avatar: ev.sender?.profile_pic || null, // sim can include it; real avatar via fetchProfile
          text: ev.message.text || '',
          attachments: ev.message.attachments || [],
          externalMessageId: ev.message.mid,
          referral: parseReferral(ev.referral || ev.message?.referral || ev.postback?.referral),
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

  async fetchProfile(account, participantId) {
    const token = account?.credential?.accessToken;
    if (!token || !participantId) return null;
    // Messenger/WhatsApp expose first_name/last_name; Instagram exposes name/username.
    const fields = this.type === 'instagram' ? 'name,username,profile_pic' : 'first_name,last_name,profile_pic';
    const res = await fetch(`https://graph.facebook.com/v19.0/${participantId}?fields=${fields}&access_token=${token}`);
    if (!res.ok) return null;
    const d = await res.json();
    const name = d.name || [d.first_name, d.last_name].filter(Boolean).join(' ') || d.username || null;
    return { name: name || null, avatar: d.profile_pic || null };
  }
}

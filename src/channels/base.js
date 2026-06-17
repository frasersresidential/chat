import { logger } from '../logger.js';

/**
 * Base class every channel adapter extends. An adapter is stateless: all
 * credentials arrive via the `account` (ChannelAccount) argument, so a single
 * adapter instance serves many connected accounts (e.g. 5 LINE OAs).
 *
 * Subclasses override:
 *   resolveAccountId(body)            → external account id present in payload
 *   verifyChallenge(query, account)   → echo string for webhook subscription
 *   verifySignature(raw, headers, a)  → boolean
 *   parseInbound(body, account)       → NormalizedInbound[]
 *   deliver(account, conversation, text) → external message id
 *
 * NormalizedInbound:
 *   { participantId, participantName, avatar, text, attachments,
 *     externalMessageId, timestamp }
 */
export class BaseAdapter {
  constructor(type) {
    this.type = type;
    this.log = logger(`channel:${type}`);
  }

  resolveAccountId(_body) {
    return null;
  }

  verifyChallenge(_query, _account) {
    return null;
  }

  // Default: accept (used when an account has no signing secret configured).
  verifySignature(_raw, _headers, _account) {
    return true;
  }

  parseInbound(_body, _account) {
    return [];
  }

  async deliver(_account, _conversation, _text) {
    throw new Error(`${this.type}.deliver not implemented`);
  }

  /**
   * Outbound entry point. Real delivery only happens when the account carries a
   * usable access token; otherwise we simulate so the whole platform runs with
   * zero credentials (the message is still stored & shown in the inbox).
   */
  async send(account, conversation, text, attachments = []) {
    const token = account?.credential?.accessToken;
    const media = attachments.length ? ` [+${attachments.length} attachment(s)]` : '';
    if (!token) {
      this.log.info(`[simulated send] ${this.type} → ${conversation.customer?.name}: ${text}${media}`);
      return `sim_${Date.now()}`;
    }
    try {
      return await this.deliver(account, conversation, text, attachments);
    } catch (err) {
      this.log.error(`delivery failed: ${err.message}`);
      throw err;
    }
  }
}

import { MetaAdapter } from './meta.js';

/**
 * Instagram Messaging. Delivered through the same Meta Graph endpoints as
 * Messenger; payload shape is identical (entry[].messaging[]).
 */
export class InstagramAdapter extends MetaAdapter {
  constructor() {
    super('instagram');
  }
}

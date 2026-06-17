import { MetaAdapter } from './meta.js';

/** Facebook Messenger. Inherits all behaviour from MetaAdapter. */
export class MessengerAdapter extends MetaAdapter {
  constructor() {
    super('messenger');
  }
}

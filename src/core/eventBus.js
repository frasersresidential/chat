import { EventEmitter } from 'node:events';

/**
 * App-wide event bus. The realtime (WebSocket) layer subscribes to these
 * events and pushes them to connected agents. Decouples business logic from
 * transport.
 *
 * Events:
 *   'conversation:upserted'  payload: Conversation
 *   'message:created'        payload: { conversation, message }
 */
export const bus = new EventEmitter();
bus.setMaxListeners(0);

import { db } from '../store/db.js';
import { bus } from './eventBus.js';

/** Valid agent availability states. Only ONLINE receives round-robin work. */
export const PRESENCE = {
  ONLINE: 'online',
  BUSY: 'busy',
  AWAY: 'away',
  OFFLINE: 'offline',
};

export function setPresence(userId, status) {
  if (!Object.values(PRESENCE).includes(status)) {
    throw new Error(`invalid presence: ${status}`);
  }
  const user = db.users.update(userId, { presence: status });
  if (user) bus.emit('user:presence', user);
  return user;
}

export function isAvailable(user) {
  return !!user && user.presence === PRESENCE.ONLINE;
}

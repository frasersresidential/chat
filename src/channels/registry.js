import { MessengerAdapter } from './messenger.js';
import { InstagramAdapter } from './instagram.js';
import { WhatsAppAdapter } from './whatsapp.js';
import { LineAdapter } from './line.js';
import { XAdapter } from './x.js';
import { TikTokAdapter } from './tiktok.js';
import { MockAdapter } from './mock.js';

/** One adapter instance per channel type; each serves many ChannelAccounts. */
const adapters = {
  messenger: new MessengerAdapter(),
  instagram: new InstagramAdapter(),
  whatsapp: new WhatsAppAdapter(),
  line: new LineAdapter(),
  x: new XAdapter(),
  tiktok: new TikTokAdapter(),
  mock: new MockAdapter(),
};

export function getAdapter(type) {
  return adapters[type] || null;
}

export const CHANNEL_TYPES = Object.keys(adapters);

/** Display metadata for the UI. */
export const CHANNEL_META = {
  messenger: { label: 'Facebook Messenger', color: '#0084FF', icon: '💬' },
  instagram: { label: 'Instagram', color: '#E1306C', icon: '📸' },
  whatsapp: { label: 'WhatsApp Business', color: '#25D366', icon: '🟢' },
  line: { label: 'LINE OA', color: '#06C755', icon: '🟩' },
  x: { label: 'X (Twitter)', color: '#000000', icon: '𝕏' },
  tiktok: { label: 'TikTok', color: '#FE2C55', icon: '🎵' },
  mock: { label: 'Mock / Sandbox', color: '#8892b0', icon: '🧪' },
};

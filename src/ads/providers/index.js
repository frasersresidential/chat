import { metaProvider } from './meta.js';
import { googleProvider } from './google.js';

export const AD_PLATFORMS = {
  meta: { label: 'Meta Ads', icon: '📘', color: '#1877F2' },
  google: { label: 'Google Ads', icon: '🔎', color: '#34A853' },
};

const providers = { meta: metaProvider, google: googleProvider };

export function getAdsProvider(account) {
  const p = providers[account.platform];
  if (!p) throw new Error(`unknown ads platform: ${account.platform}`);
  return p;
}

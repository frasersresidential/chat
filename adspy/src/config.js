import 'dotenv/config';

/**
 * Central config. The dashboard runs with zero credentials: no Ad Library
 * token → mock demo data; no VAPID keys → an ephemeral pair per boot.
 */
export const config = {
  port: Number(process.env.PORT || 4000),
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`,

  // Single shared dashboard password (demo-grade auth, like OmniChat's demo login).
  password: process.env.ADSPY_PASSWORD || 'spy1234',
  authSecret: process.env.AUTH_SECRET || 'adspy-dev-secret-change-me',

  // Meta Ad Library. With a token the dashboard queries the real public
  // Ad Library API; without one it serves a deterministic mock dataset.
  adLibraryToken: process.env.META_AD_LIBRARY_TOKEN || '',
  defaultCountry: (process.env.AD_LIBRARY_COUNTRY || 'TH').toUpperCase().slice(0, 2),

  // How often the scheduler re-checks every watched competitor.
  refreshHours: Number(process.env.REFRESH_HOURS || 6),
};

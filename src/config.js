import 'dotenv/config';

/**
 * Central config. Every channel reads its credentials from here so that the
 * rest of the codebase never touches process.env directly.
 *
 * A channel is considered "enabled" only when its required secrets are present.
 * When a channel is disabled it still appears in the UI but is read-only /
 * simulated, which lets the whole app run locally with zero credentials.
 */
export const config = {
  port: Number(process.env.PORT || 3000),
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`,
  // Secret used to sign JWTs. Set AUTH_SECRET in production.
  authSecret: process.env.AUTH_SECRET || 'omnichat-dev-secret-change-me',
  // Default password seeded users get, so the demo is loginable out of the box.
  demoPassword: process.env.DEMO_PASSWORD || 'demo1234',

  // AI ads optimization (Meta / Google). Accounts with no credentials run in
  // simulated mode; ANTHROPIC_API_KEY unlocks the Claude strategy advisor.
  ads: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
    googleApiVersion: process.env.GOOGLE_ADS_API_VERSION || 'v21',
    meta: {
      accessToken: process.env.META_ADS_ACCESS_TOKEN || '',
      adAccountId: process.env.META_ADS_ACCOUNT_ID || '',
    },
    google: {
      developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
      clientId: process.env.GOOGLE_ADS_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
      refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
      customerId: process.env.GOOGLE_ADS_CUSTOMER_ID || '',
      loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '',
    },
  },

  channels: {
    messenger: {
      pageAccessToken: process.env.MESSENGER_PAGE_ACCESS_TOKEN || '',
      appSecret: process.env.MESSENGER_APP_SECRET || '',
      verifyToken: process.env.MESSENGER_VERIFY_TOKEN || '',
    },
    instagram: {
      pageAccessToken: process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || '',
      appSecret: process.env.INSTAGRAM_APP_SECRET || '',
      verifyToken: process.env.INSTAGRAM_VERIFY_TOKEN || '',
    },
    tiktok: {
      clientKey: process.env.TIKTOK_CLIENT_KEY || '',
      clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
      accessToken: process.env.TIKTOK_ACCESS_TOKEN || '',
    },
    line: {
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
      channelSecret: process.env.LINE_CHANNEL_SECRET || '',
    },
    x: {
      bearerToken: process.env.X_BEARER_TOKEN || '',
      apiKey: process.env.X_API_KEY || '',
      apiSecret: process.env.X_API_SECRET || '',
      accessToken: process.env.X_ACCESS_TOKEN || '',
      accessSecret: process.env.X_ACCESS_SECRET || '',
      webhookSecret: process.env.X_WEBHOOK_SECRET || '',
    },
  },
};

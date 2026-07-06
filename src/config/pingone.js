import dotenv from 'dotenv';
import { normalizeTokenAuthMethod, usesPrivateKeyJwt } from '../lib/jwks.js';

dotenv.config();

const regionHosts = {
  NA: 'auth.pingone.com',
  EU: 'auth.pingone.eu',
  AP: 'auth.pingone.asia',
  CA: 'auth.pingone.ca',
};

const environmentId = process.env.PINGONE_ENVIRONMENT_ID;
const region = (process.env.PINGONE_REGION || 'NA').toUpperCase();
const authHost = regionHosts[region] || regionHosts.NA;
const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

export const pingoneConfig = {
  environmentId,
  region,
  authHost,
  issuer: environmentId ? `https://${authHost}/${environmentId}/as` : null,
  baseUrl,
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-session-secret',
  port: Number(process.env.PORT) || 3000,
};

export function appConfig(key, defaults = {}) {
  const prefix = key.toUpperCase();
  const globalMethod = process.env.PINGONE_TOKEN_AUTH_METHOD || 'client_secret_basic';
  const fallback = defaults.defaultTokenAuthMethod || globalMethod;
  const tokenAuthMethod = normalizeTokenAuthMethod(
    process.env[`${prefix}_TOKEN_AUTH_METHOD`]
      || process.env[`${prefix}_AUTH_METHOD`]
      || fallback,
  );

  return {
    clientId: process.env[`${prefix}_CLIENT_ID`] || defaults.clientId || '',
    clientSecret: process.env[`${prefix}_CLIENT_SECRET`] || defaults.clientSecret || '',
    redirectUri: `${baseUrl}${defaults.path || ''}/callback`,
    tokenAuthMethod,
    usesPrivateKeyJwt: usesPrivateKeyJwt(tokenAuthMethod),
    signingAlg: (process.env.JWKS_SIGNING_ALG || 'RS256').toUpperCase(),
    ...defaults,
  };
}

export function isConfigured(clientId) {
  return Boolean(clientId && pingoneConfig.environmentId);
}

export function missingConfigMessage(appName, clientId, tokenAuthMethod = 'client_secret_basic') {
  if (!pingoneConfig.environmentId) {
    return 'Set PINGONE_ENVIRONMENT_ID in your .env file.';
  }
  if (!clientId) {
    return `Set ${appName.toUpperCase().replace(/-/g, '_')}_CLIENT_ID in your .env file.`;
  }
  if (!usesPrivateKeyJwt(tokenAuthMethod) && !process.env[`${appName.toUpperCase().replace(/-/g, '_')}_CLIENT_SECRET`]) {
    return `Set ${appName.toUpperCase().replace(/-/g, '_')}_CLIENT_SECRET in your .env file (or use TOKEN_AUTH_METHOD=private_key_jwt).`;
  }
  return null;
}

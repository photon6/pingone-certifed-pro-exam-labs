import { pingoneConfig } from '../config/pingone.js';

function parseRedirectError(location) {
  if (!location) return null;
  try {
    const url = new URL(location);
    const errorParam = url.searchParams.get('error');
    if (!errorParam) return null;
    return JSON.parse(errorParam);
  } catch {
    return { code: 'UNKNOWN', message: location };
  }
}

export async function verifyOAuthApplication({
  clientId,
  redirectUri,
  scope = 'openid profile email',
}) {
  if (!pingoneConfig.issuer || !clientId) {
    return { ok: false, code: 'NOT_CONFIGURED', message: 'Missing issuer or client ID.' };
  }

  const url = new URL(`${pingoneConfig.issuer}/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', 'verify');
  url.searchParams.set('nonce', 'verify');

  const response = await fetch(url, { redirect: 'manual' });
  const location = response.headers.get('location');

  if (response.status >= 300 && response.status < 400) {
    const error = parseRedirectError(location);
    if (error) {
      return {
        ok: false,
        code: error.code,
        message: error.message,
        pingoneErrorId: error.id,
      };
    }
    if (location?.includes('flowId=') || location?.includes('/signon/')) {
      return { ok: true };
    }
  }

  if (response.ok) {
    return { ok: true };
  }

  return {
    ok: false,
    code: 'UNEXPECTED_RESPONSE',
    message: `PingOne authorize returned HTTP ${response.status}.`,
  };
}

export const notFoundChecklist = [
  'Confirm WEB_AUTH_CLIENT_ID matches the Client ID on your PingOne Web App (OIDC) application Overview tab.',
  'Confirm PINGONE_ENVIRONMENT_ID matches the Environment ID shown on that same application.',
  'Confirm PINGONE_REGION matches your tenant region (NA → auth.pingone.com, EU → auth.pingone.eu, AP → auth.pingone.asia, CA → auth.pingone.ca).',
  'Ensure the application is enabled (Applications → your app → toggle Enabled).',
  'Assign a sign-on policy: Applications → your app → Policies → Sign-on.',
  'Grant OpenID scopes: Applications → your app → Access → openid, profile, email.',
  'Set redirect URI exactly to the value shown on this lab page (including path, no trailing slash).',
];

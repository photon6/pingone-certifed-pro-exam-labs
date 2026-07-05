import { decodeProtectedHeader, decodeJwt } from 'jose';

export function isJwt(token) {
  return typeof token === 'string' && token.split('.').length === 3;
}

export function decodeJwtParts(token) {
  if (!isJwt(token)) return null;
  try {
    return {
      jwt_header: decodeProtectedHeader(token),
      jwt_payload: decodeJwt(token),
    };
  } catch {
    return null;
  }
}

export function summarizeTokenSet(tokens) {
  if (!tokens) return null;

  const summary = {
    token_type: tokens.token_type,
    expires_in: tokens.expires_in,
    scope: tokens.scope,
  };

  if (tokens.expires_at) {
    summary.expires_at = new Date(tokens.expires_at * 1000).toISOString();
  }

  if (tokens.id_token) {
    summary.id_token = decodeJwtParts(tokens.id_token) || { format: 'undecodable' };
  }

  if (tokens.access_token) {
    summary.access_token = decodeJwtParts(tokens.access_token) || { format: 'opaque' };
  }

  if (tokens.refresh_token) {
    summary.refresh_token = decodeJwtParts(tokens.refresh_token) || { format: 'opaque' };
  }

  return summary;
}

export function summarizeAccessToken(accessToken) {
  if (!accessToken) return null;
  const decoded = decodeJwtParts(accessToken);
  return decoded || { format: 'opaque' };
}

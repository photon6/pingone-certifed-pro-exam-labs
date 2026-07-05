export function isJwt(token) {
  return typeof token === 'string' && token.split('.').length === 3;
}

function base64UrlDecode(input) {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
      .join(''),
  );
}

export function decodeJwtParts(token) {
  if (!isJwt(token)) return null;
  try {
    const [headerPart, payloadPart] = token.split('.');
    return {
      jwt_header: JSON.parse(base64UrlDecode(headerPart)),
      jwt_payload: JSON.parse(base64UrlDecode(payloadPart)),
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

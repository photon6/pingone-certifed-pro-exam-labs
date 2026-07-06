import crypto from 'crypto';
import { SignJWT, importJWK } from 'jose';
import { getKeyMaterial, normalizeTokenAuthMethod } from './jwks.js';

async function signClientAssertion(clientId, audience) {
  const { privateJwk, signingAlg } = await getKeyMaterial();
  const key = await importJWK(privateJwk, signingAlg);
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: signingAlg, kid: privateJwk.kid })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience(audience)
    .setJti(crypto.randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(key);
}

export async function applyClientAuth({ clientId, clientSecret, tokenAuthMethod, audience }) {
  const method = normalizeTokenAuthMethod(tokenAuthMethod);
  const form = {};
  const headers = {};

  switch (method) {
    case 'none':
      form.client_id = clientId;
      break;
    case 'client_secret_post':
      form.client_id = clientId;
      form.client_secret = clientSecret;
      break;
    case 'client_secret_basic':
      headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
      break;
    case 'private_key_jwt':
      form.client_id = clientId;
      form.client_assertion_type = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
      form.client_assertion = await signClientAssertion(clientId, audience);
      break;
    default:
      throw new Error(`Unsupported token auth method: ${method}`);
  }

  return { form, headers };
}

export async function postFormJson(url, params, auth) {
  for (const [key, value] of Object.entries(auth.form)) {
    params.set(key, value);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...auth.headers,
    },
    body: params.toString(),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(body.error_description || body.error || `Request failed (${response.status})`);
    err.error = body.error;
    err.error_description = body.error_description;
    err.status = response.status;
    throw err;
  }

  return body;
}

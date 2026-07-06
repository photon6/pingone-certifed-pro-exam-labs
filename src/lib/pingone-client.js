import * as client from 'openid-client';
import { pingoneConfig } from '../config/pingone.js';
import {
  getPrivateJwksForClient,
  getKeyMaterial,
  normalizeTokenAuthMethod,
  signRequestObject,
} from './jwks.js';

let issuerPromise;

export function getIssuer() {
  if (!pingoneConfig.issuer) {
    throw new Error('PingOne is not configured. Set PINGONE_ENVIRONMENT_ID in .env');
  }
  if (!issuerPromise) {
    issuerPromise = client.Issuer.discover(pingoneConfig.issuer).catch((err) => {
      issuerPromise = null;
      const hint = err.message?.includes('403')
        ? ` Check PINGONE_ENVIRONMENT_ID (${pingoneConfig.environmentId}) and PINGONE_REGION (${pingoneConfig.region}).`
        : '';
      throw new Error(`PingOne OIDC discovery failed at ${pingoneConfig.issuer}: ${err.message}.${hint}`);
    });
  }
  return issuerPromise;
}

async function buildClientMetadata({
  clientId,
  clientSecret,
  redirectUri,
  responseTypes = ['code'],
  tokenAuthMethod = 'client_secret_basic',
}) {
  const method = normalizeTokenAuthMethod(tokenAuthMethod);
  const metadata = {
    client_id: clientId,
    redirect_uris: redirectUri ? [redirectUri] : undefined,
    response_types: responseTypes,
    token_endpoint_auth_method: method,
  };

  if (method === 'private_key_jwt') {
    const { signingAlg } = await getKeyMaterial();
    metadata.token_endpoint_auth_signing_alg = signingAlg;
    metadata.jwks = await getPrivateJwksForClient();
  } else if (method !== 'none') {
    metadata.client_secret = clientSecret;
  }

  return metadata;
}

function instantiateClient(issuer, metadata) {
  const { jwks, ...clientMetadata } = metadata;
  // openid-client loads signing keys from the second constructor arg, not metadata.jwks
  return jwks ? new issuer.Client(clientMetadata, jwks) : new issuer.Client(clientMetadata);
}

export async function createOAuthClient(options) {
  const issuer = await getIssuer();
  const metadata = await buildClientMetadata(options);
  return instantiateClient(issuer, metadata);
}

export async function createConfidentialClient(options) {
  return createOAuthClient({
    ...options,
    tokenAuthMethod: options.tokenAuthMethod || 'client_secret_basic',
  });
}

export async function createPublicClient({ clientId, redirectUri, responseTypes = ['code'] }) {
  return createOAuthClient({
    clientId,
    redirectUri,
    responseTypes,
    tokenAuthMethod: 'none',
  });
}

export async function createWorkerClient({ clientId, clientSecret, tokenAuthMethod = 'client_secret_basic' }) {
  const issuer = await getIssuer();
  const metadata = await buildClientMetadata({ clientId, clientSecret, tokenAuthMethod });
  delete metadata.redirect_uris;
  delete metadata.response_types;
  return instantiateClient(issuer, metadata);
}

export async function clientCredentialsToken({ clientId, clientSecret, scope, tokenAuthMethod }) {
  const oauthClient = await createWorkerClient({ clientId, clientSecret, tokenAuthMethod });
  return oauthClient.grant({ grant_type: 'client_credentials', scope });
}

export async function exchangeToken({
  clientId,
  clientSecret,
  subjectToken,
  subjectTokenType = 'urn:ietf:params:oauth:token-type:access_token',
  audience,
  scope,
  requestedTokenType = 'urn:ietf:params:oauth:token-type:access_token',
  tokenAuthMethod,
}) {
  const oauthClient = await createWorkerClient({ clientId, clientSecret, tokenAuthMethod });

  const params = {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: subjectToken,
    subject_token_type: subjectTokenType,
    requested_token_type: requestedTokenType,
  };
  if (audience) params.audience = audience;
  if (scope) params.scope = scope;

  return oauthClient.grant(params);
}

export async function deviceAuthorization({ clientId, scope }) {
  const oauthClient = await createPublicClient({
    clientId,
    redirectUri: 'urn:ietf:wg:oauth:2.0:oob',
  });
  const handle = await oauthClient.deviceAuthorization({ scope });
  return {
    device_code: handle.device_code,
    user_code: handle.user_code,
    verification_uri: handle.verification_uri,
    verification_uri_complete: handle.verification_uri_complete,
    expires_in: handle.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + handle.expires_in,
    interval: 5,
  };
}

export async function pollDeviceAuthorizationOnce(oauthClient, deviceCode) {
  try {
    const tokens = await oauthClient.grant({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
    });
    return { status: 'complete', tokens };
  } catch (err) {
    if (err.error === 'authorization_pending') {
      return { status: 'pending' };
    }
    if (err.error === 'slow_down') {
      return { status: 'pending', slowDown: true };
    }
    if (err.error === 'expired_token') {
      return { status: 'expired', error: err.message };
    }
    throw err;
  }
}

export async function createDeviceFlowClient(clientId) {
  return createPublicClient({
    clientId,
    redirectUri: 'urn:ietf:wg:oauth:2.0:oob',
  });
}

/** @deprecated Use pollDeviceAuthorizationOnce for incremental polling UIs */
export async function pollDeviceToken(oauthClient, deviceCode) {
  const result = await pollDeviceAuthorizationOnce(oauthClient, deviceCode);
  if (result.status === 'complete') return result.tokens;
  if (result.status === 'pending') {
    const err = new Error('authorization_pending');
    err.error = 'authorization_pending';
    throw err;
  }
  throw new Error(result.error || 'Device authorization failed');
}

export async function initiateCiba({
  clientId,
  clientSecret,
  loginHint,
  bindingMessage,
  requestedExpiry = 300,
  acrValues,
  tokenAuthMethod = 'client_secret_post',
}) {
  const oauthClient = await createWorkerClient({
    clientId,
    clientSecret,
    tokenAuthMethod: tokenAuthMethod || 'client_secret_post',
  });

  const params = {
    scope: 'openid profile',
    login_hint: loginHint,
    requested_expiry: requestedExpiry,
  };
  if (bindingMessage) params.binding_message = bindingMessage;
  if (acrValues) params.acr_values = acrValues;

  return oauthClient.backchannelAuthentication(params);
}

export async function pollCibaToken(oauthClient, authReqId, interval = 2) {
  return oauthClient.pollBackchannelAuthenticationGrant(authReqId, { interval });
}

export async function pushedAuthorizationRequest(oauthClient, params) {
  if (typeof oauthClient.pushedAuthorizationRequest !== 'function') {
    throw new Error('PAR is not supported by this openid-client version or issuer metadata.');
  }
  return oauthClient.pushedAuthorizationRequest(params);
}

export function buildAuthorizationUrl(oauthClient, params) {
  return oauthClient.authorizationUrl(params);
}

export async function buildSignedAuthorizationUrl(oauthClient, params, clientId) {
  const requestJwt = await signRequestObject(params, clientId);
  return oauthClient.authorizationUrl({ request: requestJwt, client_id: clientId });
}

export function authorizationCodeGrant(oauthClient, req, checks = {}) {
  const params = oauthClient.callbackParams(req);
  return oauthClient.callback(oauthClient.redirect_uris[0], params, checks);
}

export function refreshTokenGrant(oauthClient, refreshToken) {
  return oauthClient.refresh(refreshToken);
}

export function generatePkce() {
  const code_verifier = client.generators.codeVerifier();
  const code_challenge = client.generators.codeChallenge(code_verifier);
  return { code_verifier, code_challenge };
}

export function generateState() {
  return client.generators.state();
}

export function generateNonce() {
  return client.generators.nonce();
}

export { signRequestObject };

import * as client from 'openid-client';
import { pingoneConfig } from '../config/pingone.js';

let issuerPromise;

export function getIssuer() {
  if (!pingoneConfig.issuer) {
    throw new Error('PingOne is not configured. Set PINGONE_ENVIRONMENT_ID in .env');
  }
  if (!issuerPromise) {
    issuerPromise = client.Issuer.discover(pingoneConfig.issuer);
  }
  return issuerPromise;
}

export async function createConfidentialClient({ clientId, clientSecret, redirectUri, responseTypes = ['code'] }) {
  const issuer = await getIssuer();
  return new issuer.Client({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: [redirectUri],
    response_types: responseTypes,
  });
}

export async function createPublicClient({ clientId, redirectUri, responseTypes = ['code'] }) {
  const issuer = await getIssuer();
  return new issuer.Client({
    client_id: clientId,
    redirect_uris: [redirectUri],
    response_types: responseTypes,
    token_endpoint_auth_method: 'none',
  });
}

export async function clientCredentialsToken({ clientId, clientSecret, scope }) {
  const issuer = await getIssuer();
  const oauthClient = new issuer.Client({
    client_id: clientId,
    client_secret: clientSecret,
    token_endpoint_auth_method: 'client_secret_basic',
  });
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
}) {
  const issuer = await getIssuer();
  const oauthClient = new issuer.Client({
    client_id: clientId,
    client_secret: clientSecret,
    token_endpoint_auth_method: 'client_secret_basic',
  });

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
  const issuer = await getIssuer();
  const oauthClient = new issuer.Client({
    client_id: clientId,
    token_endpoint_auth_method: 'none',
  });
  return oauthClient.deviceAuthorization({ scope });
}

export async function pollDeviceToken(oauthClient, deviceCode, interval = 5) {
  return oauthClient.pollDeviceAuthorizationGrant(deviceCode, { interval });
}

export async function initiateCiba({
  clientId,
  clientSecret,
  loginHint,
  bindingMessage,
  requestedExpiry = 300,
  acrValues,
}) {
  const issuer = await getIssuer();
  const oauthClient = new issuer.Client({
    client_id: clientId,
    client_secret: clientSecret,
    token_endpoint_auth_method: 'client_secret_post',
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

export function authorizationCodeGrant(oauthClient, callbackUrl, checks = {}) {
  return oauthClient.callback(oauthClient.redirect_uris[0], callbackUrl, checks);
}

export function refreshTokenGrant(oauthClient, refreshToken) {
  return oauthClient.refresh(refreshToken);
}

export function generatePkce() {
  return client.generators.pkce();
}

export function generateState() {
  return client.generators.state();
}

export function generateNonce() {
  return client.generators.nonce();
}

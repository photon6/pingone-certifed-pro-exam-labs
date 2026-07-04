import { Router } from 'express';
import { appConfig, isConfigured, missingConfigMessage } from '../../config/pingone.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import {
  createConfidentialClient,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  refreshTokenGrant,
  generateState,
  generateNonce,
} from '../../lib/pingone-client.js';
import { getLab } from '../../lib/lab-meta.js';

const config = appConfig('LONG_SESSION', { path: '/labs/long-session' });
const lab = getLab('long-session');

const router = Router();

router.get('/', (req, res) => {
  const configured = isConfigured(config.clientId);
  const session = req.session.longSession;
  res.render('lab', {
    lab,
    configured,
    configError: missingConfigMessage('LONG_SESSION', config.clientId),
    redirectUri: config.redirectUri,
    user: session?.userinfo || null,
    tokens: session?.tokens ? summarizeTokens(session.tokens) : null,
    refreshHistory: session?.refreshHistory || [],
    scopeNote: 'Request openid profile offline_access to receive refresh tokens.',
  });
});

router.get('/login', asyncHandler(async (req, res) => {
  const oauthClient = await createConfidentialClient(config);
  const state = generateState();
  const nonce = generateNonce();
  req.session.longSessionOauth = { state, nonce };

  const url = buildAuthorizationUrl(oauthClient, {
    scope: 'openid profile offline_access',
    state,
    nonce,
  });
  res.redirect(url);
}));

router.get('/callback', asyncHandler(async (req, res) => {
  const oauthClient = await createConfidentialClient(config);
  const { state, nonce } = req.session.longSessionOauth || {};
  const tokenSet = await authorizationCodeGrant(oauthClient, req, { state, nonce });
  const userinfo = await oauthClient.userinfo(tokenSet.access_token);

  req.session.longSession = {
    tokens: tokenSet,
    userinfo,
    refreshHistory: [{ at: new Date().toISOString(), action: 'initial_login' }],
  };
  delete req.session.longSessionOauth;
  res.redirect('/labs/long-session');
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const session = req.session.longSession;
  if (!session?.tokens?.refresh_token) {
    return res.status(400).render('error', {
      title: 'No refresh token',
      message: 'Log in first. Ensure offline_access scope is enabled on your PingOne app.',
      details: null,
    });
  }

  const oauthClient = await createConfidentialClient(config);
  const newTokens = await refreshTokenGrant(oauthClient, session.tokens.refresh_token);
  session.tokens = newTokens;
  session.refreshHistory = session.refreshHistory || [];
  session.refreshHistory.push({ at: new Date().toISOString(), action: 'refresh' });
  res.redirect('/labs/long-session');
}));

router.post('/logout', (req, res) => {
  delete req.session.longSession;
  delete req.session.longSessionOauth;
  res.redirect('/labs/long-session');
});

function summarizeTokens(tokens) {
  return {
    token_type: tokens.token_type,
    expires_in: tokens.expires_in,
    scope: tokens.scope,
    has_id_token: Boolean(tokens.id_token),
    has_access_token: Boolean(tokens.access_token),
    has_refresh_token: Boolean(tokens.refresh_token),
    expires_at: tokens.expires_at ? new Date(tokens.expires_at * 1000).toISOString() : null,
  };
}

export default router;

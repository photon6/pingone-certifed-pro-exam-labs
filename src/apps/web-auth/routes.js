import { Router } from 'express';
import { appConfig, isConfigured, missingConfigMessage } from '../../config/pingone.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import {
  createConfidentialClient,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  generateState,
  generateNonce,
} from '../../lib/pingone-client.js';
import { getLab } from '../../lib/lab-meta.js';

const config = appConfig('WEB_AUTH', { path: '/labs/web-auth' });
const lab = getLab('web-auth');

const router = Router();

router.get('/', (req, res) => {
  const configured = isConfigured(config.clientId);
  res.render('lab', {
    lab,
    configured,
    configError: missingConfigMessage('WEB_AUTH', config.clientId),
    redirectUri: config.redirectUri,
    user: req.session.webAuth?.userinfo || null,
    tokens: req.session.webAuth?.tokens ? summarizeTokens(req.session.webAuth.tokens) : null,
  });
});

router.get('/login', asyncHandler(async (req, res) => {
  const oauthClient = await createConfidentialClient(config);
  const state = generateState();
  const nonce = generateNonce();
  req.session.webAuthOauth = { state, nonce };

  const url = buildAuthorizationUrl(oauthClient, {
    scope: 'openid profile email',
    state,
    nonce,
  });
  res.redirect(url);
}));

router.get('/callback', asyncHandler(async (req, res) => {
  const oauthClient = await createConfidentialClient(config);
  const { state, nonce } = req.session.webAuthOauth || {};
  const tokenSet = await authorizationCodeGrant(oauthClient, req.originalUrl, { state, nonce });
  const userinfo = await oauthClient.userinfo(tokenSet.access_token);

  req.session.webAuth = { tokens: tokenSet, userinfo };
  delete req.session.webAuthOauth;
  res.redirect('/labs/web-auth');
}));

router.post('/logout', (req, res) => {
  delete req.session.webAuth;
  delete req.session.webAuthOauth;
  res.redirect('/labs/web-auth');
});

function summarizeTokens(tokens) {
  return {
    token_type: tokens.token_type,
    expires_in: tokens.expires_in,
    scope: tokens.scope,
    has_id_token: Boolean(tokens.id_token),
    has_access_token: Boolean(tokens.access_token),
    has_refresh_token: Boolean(tokens.refresh_token),
  };
}

export default router;

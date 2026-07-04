import { Router } from 'express';
import { appConfig, isConfigured, missingConfigMessage } from '../../config/pingone.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import {
  createPublicClient,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  generatePkce,
  generateState,
  generateNonce,
} from '../../lib/pingone-client.js';
import { getLab } from '../../lib/lab-meta.js';

const config = appConfig('MOBILE', { path: '/labs/mobile' });
const lab = getLab('mobile');

const router = Router();

router.get('/', (req, res) => {
  const configured = isConfigured(config.clientId);
  res.render('lab', {
    lab,
    configured,
    configError: missingConfigMessage('MOBILE', config.clientId),
    redirectUri: config.redirectUri,
    user: req.session.mobile?.userinfo || null,
    tokens: req.session.mobile?.tokens ? summarizeTokens(req.session.mobile.tokens) : null,
    pkceNote: 'Native apps use PKCE and no client secret. Configure redirect URI as shown below.',
  });
});

router.get('/login', asyncHandler(async (req, res) => {
  const oauthClient = await createPublicClient(config);
  const state = generateState();
  const nonce = generateNonce();
  const { code_verifier, code_challenge } = generatePkce();
  req.session.mobileOauth = { state, nonce, code_verifier };

  const url = buildAuthorizationUrl(oauthClient, {
    scope: 'openid profile',
    state,
    nonce,
    code_challenge,
    code_challenge_method: 'S256',
  });
  res.redirect(url);
}));

router.get('/callback', asyncHandler(async (req, res) => {
  const oauthClient = await createPublicClient(config);
  const { state, nonce, code_verifier } = req.session.mobileOauth || {};
  const tokenSet = await authorizationCodeGrant(oauthClient, req.originalUrl, {
    state,
    nonce,
    code_verifier,
  });
  const userinfo = await oauthClient.userinfo(tokenSet.access_token);

  req.session.mobile = { tokens: tokenSet, userinfo };
  delete req.session.mobileOauth;
  res.redirect('/labs/mobile');
}));

router.post('/logout', (req, res) => {
  delete req.session.mobile;
  delete req.session.mobileOauth;
  res.redirect('/labs/mobile');
});

function summarizeTokens(tokens) {
  return {
    token_type: tokens.token_type,
    expires_in: tokens.expires_in,
    scope: tokens.scope,
    has_id_token: Boolean(tokens.id_token),
    has_access_token: Boolean(tokens.access_token),
  };
}

export default router;

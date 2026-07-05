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
import { summarizeTokenSet } from '../../lib/jwt-display.js';

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
    tokens: req.session.mobile?.tokens ? summarizeTokenSet(req.session.mobile.tokens) : null,
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
  const tokenSet = await authorizationCodeGrant(oauthClient, req, {
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

export default router;

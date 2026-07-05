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
import { verifyOAuthApplication, notFoundChecklist } from '../../lib/pingone-verify.js';
import { summarizeTokenSet } from '../../lib/jwt-display.js';
import { getLab } from '../../lib/lab-meta.js';

const config = appConfig('WEB_AUTH', { path: '/labs/web-auth' });
const lab = getLab('web-auth');

const router = Router();

function consumeOAuthReturn(req, tokenSet) {
  const oauthReturn = req.session.oauthReturn;
  if (!oauthReturn) return null;

  if (oauthReturn.target === 'api-access') {
    req.session.apiAccess = { tokens: tokenSet };
  }

  const redirectTo = oauthReturn.path || '/labs/web-auth';
  delete req.session.oauthReturn;
  return redirectTo;
}

router.get('/', asyncHandler(async (req, res) => {
  const configured = isConfigured(config.clientId);
  let appVerification = null;

  if (configured) {
    appVerification = await verifyOAuthApplication({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
    });
  }

  res.render('lab', {
    lab,
    configured,
    configError: missingConfigMessage('web-auth', config.clientId, config.tokenAuthMethod),
    redirectUri: config.redirectUri,
    clientId: config.clientId,
    tokenAuthMethod: config.tokenAuthMethod,
    appVerification,
    notFoundChecklist,
    user: req.session.webAuth?.userinfo || null,
    tokens: req.session.webAuth?.tokens ? summarizeTokenSet(req.session.webAuth.tokens) : null,
  });
}));

router.get('/login', asyncHandler(async (req, res) => {
  const verification = await verifyOAuthApplication({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
  });

  if (!verification.ok) {
    return res.status(400).render('error', {
      title: 'PingOne application not ready',
      message: verification.code === 'NOT_FOUND'
        ? 'PingOne could not find this application in your environment. Check WEB_AUTH_CLIENT_ID and PINGONE_ENVIRONMENT_ID in .env, then review the setup checklist on the lab page.'
        : `${verification.code}: ${verification.message}`,
      details: verification.pingoneErrorId ? `PingOne error ID: ${verification.pingoneErrorId}` : null,
      backUrl: '/labs/web-auth',
      backLabel: 'Back to Web Auth Lab',
    });
  }

  const oauthClient = await createConfidentialClient(config);
  const state = generateState();
  const nonce = generateNonce();
  const scope = req.query.scope || 'openid profile email';
  req.session.webAuthOauth = { state, nonce, scope };

  const url = buildAuthorizationUrl(oauthClient, {
    scope,
    state,
    nonce,
  });
  res.redirect(url);
}));

router.get('/callback', asyncHandler(async (req, res) => {
  const oauthClient = await createConfidentialClient(config);
  const { state, nonce } = req.session.webAuthOauth || {};
  const tokenSet = await authorizationCodeGrant(oauthClient, req, { state, nonce });

  const returnPath = consumeOAuthReturn(req, tokenSet);
  if (returnPath) {
    delete req.session.webAuthOauth;
    return res.redirect(returnPath);
  }

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

export default router;

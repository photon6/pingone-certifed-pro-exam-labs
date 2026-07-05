import { Router } from 'express';
import { appConfig, isConfigured, missingConfigMessage, pingoneConfig } from '../../config/pingone.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { validateBearerToken } from '../../middleware/bearer-auth.js';
import {
  createConfidentialClient,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  generateState,
  generateNonce,
  clientCredentialsToken,
} from '../../lib/pingone-client.js';
import { summarizeAccessToken } from '../../lib/jwt-display.js';
import { getLab } from '../../lib/lab-meta.js';

const config = appConfig('API_ACCESS');
const m2mConfig = appConfig('M2M');
const webAuthConfig = appConfig('WEB_AUTH', { path: '/labs/api-access' });
const lab = getLab('api-access');

const router = Router();

function findSessionToken(req) {
  const sources = [
    { name: 'api-access', token: req.session.apiAccess?.tokens?.access_token },
    { name: 'web-auth', token: req.session.webAuth?.tokens?.access_token },
    { name: 'mobile', token: req.session.mobile?.tokens?.access_token },
    { name: 'long-session', token: req.session.longSession?.tokens?.access_token },
    { name: 'enhanced-security', token: req.session.enhancedSecurity?.tokens?.access_token },
    { name: 'm2m', token: req.session.m2m?.rawToken },
    { name: 'token-exchange', token: req.session.tokenExchange?.subjectToken },
  ];
  return sources.find((entry) => entry.token);
}

router.get('/', (req, res) => {
  const configured = isConfigured(config.clientId);
  const sessionToken = findSessionToken(req);
  res.render('api-access-lab', {
    lab,
    configured,
    configError: missingConfigMessage('api-access', config.clientId, config.tokenAuthMethod),
    clientId: config.clientId,
    baseUrl: pingoneConfig.baseUrl,
    webAuthConfigured: isConfigured(webAuthConfig.clientId),
    m2mConfigured: isConfigured(m2mConfig.clientId),
    sessionTokenSource: sessionToken?.name || null,
    loginRedirectUri: webAuthConfig.redirectUri,
    hideTryIt: true,
  });
});

router.get('/login', asyncHandler(async (req, res) => {
  if (!isConfigured(webAuthConfig.clientId)) {
    return res.status(400).render('error', {
      title: 'Web Auth not configured',
      message: 'Set WEB_AUTH_CLIENT_ID and WEB_AUTH_CLIENT_SECRET in .env (same app from the Web Auth lab).',
      details: null,
      backUrl: '/labs/api-access',
      backLabel: 'Back to API Access',
    });
  }

  const scope = req.query.scope || 'openid profile';
  const oauthClient = await createConfidentialClient(webAuthConfig);
  const state = generateState();
  const nonce = generateNonce();
  req.session.apiAccessOauth = { state, nonce, scope };

  const url = buildAuthorizationUrl(oauthClient, { scope, state, nonce });
  res.redirect(url);
}));

router.get('/callback', asyncHandler(async (req, res) => {
  const oauthClient = await createConfidentialClient(webAuthConfig);
  const { state, nonce } = req.session.apiAccessOauth || {};
  const tokenSet = await authorizationCodeGrant(oauthClient, req, { state, nonce });

  req.session.apiAccess = { tokens: tokenSet };
  delete req.session.apiAccessOauth;
  res.redirect('/labs/api-access');
}));

router.get('/demo-token/session', (req, res) => {
  const sessionToken = findSessionToken(req);
  if (!sessionToken) {
    return res.status(404).json({
      error: 'no_session_token',
      message: 'No access token in server session. Sign in below or complete the Web Auth lab first.',
    });
  }

  res.json({
    source: sessionToken.name,
    access_token: sessionToken.token,
    decoded: summarizeAccessToken(sessionToken.token),
  });
});

router.post('/demo-token/m2m', asyncHandler(async (req, res) => {
  if (!isConfigured(m2mConfig.clientId)) {
    return res.status(400).json({
      error: 'not_configured',
      message: 'Configure M2M_CLIENT_ID and M2M_CLIENT_SECRET in .env to use client credentials.',
    });
  }

  const scope = req.body?.scope || req.query.scope || 'openid';
  const tokenSet = await clientCredentialsToken({
    clientId: m2mConfig.clientId,
    clientSecret: m2mConfig.clientSecret,
    scope,
    tokenAuthMethod: m2mConfig.tokenAuthMethod,
  });

  res.json({
    source: 'client_credentials',
    scope: tokenSet.scope,
    expires_in: tokenSet.expires_in,
    access_token: tokenSet.access_token,
    decoded: summarizeAccessToken(tokenSet.access_token),
  });
}));

router.get('/api/public', (req, res) => {
  res.json({
    message: 'This endpoint is public — no token required.',
    timestamp: new Date().toISOString(),
  });
});

router.get('/api/protected', validateBearerToken, (req, res) => {
  res.json({
    message: 'Access granted — valid PingOne access token.',
    jwt_header: req.jwtHeader,
    claims: req.tokenPayload,
    timestamp: new Date().toISOString(),
  });
});

router.get('/api/scoped', validateBearerToken, (req, res) => {
  const scopes = (req.tokenPayload.scope || '').split(' ').filter(Boolean);
  if (!scopes.includes('read:labs')) {
    return res.status(403).json({
      error: 'insufficient_scope',
      message: 'Token must include read:labs scope (configure in PingOne and request when obtaining token).',
      jwt_header: req.jwtHeader,
      token_scopes: scopes,
    });
  }
  res.json({
    message: 'Scoped access granted.',
    data: { labs: ['web-auth', 'mobile', 'spa', 'm2m'] },
    jwt_header: req.jwtHeader,
    claims: req.tokenPayload,
  });
});

export default router;

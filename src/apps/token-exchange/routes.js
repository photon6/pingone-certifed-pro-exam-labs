import { Router } from 'express';
import { appConfig, isConfigured, missingConfigMessage } from '../../config/pingone.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import {
  clientCredentialsToken,
  exchangeToken,
  createConfidentialClient,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  generateState,
  generateNonce,
} from '../../lib/pingone-client.js';
import { getLab } from '../../lib/lab-meta.js';

const config = appConfig('TOKEN_EXCHANGE');
const targetConfig = appConfig('TOKEN_EXCHANGE_TARGET');
const webConfig = appConfig('TOKEN_EXCHANGE', { path: '/labs/token-exchange' });
const lab = getLab('token-exchange');

const router = Router();

router.get('/', (req, res) => {
  const configured = isConfigured(config.clientId);
  res.render('token-exchange-lab', {
    lab,
    configured,
    configError: missingConfigMessage('token-exchange', config.clientId, config.tokenAuthMethod),
    redirectUri: webConfig.redirectUri,
    tokenAuthMethod: config.tokenAuthMethod,
    exchangeResult: req.session.tokenExchange?.result || null,
    subjectTokenPreview: req.session.tokenExchange?.subjectPreview || null,
    hideTryIt: true,
  });
});

router.get('/login', asyncHandler(async (req, res) => {
  const oauthClient = await createConfidentialClient(webConfig);
  const state = generateState();
  const nonce = generateNonce();
  req.session.tokenExchangeOauth = { state, nonce };

  const url = buildAuthorizationUrl(oauthClient, {
    scope: 'openid profile',
    state,
    nonce,
  });
  res.redirect(url);
}));

router.get('/callback', asyncHandler(async (req, res) => {
  const oauthClient = await createConfidentialClient(webConfig);
  const { state, nonce } = req.session.tokenExchangeOauth || {};
  const tokenSet = await authorizationCodeGrant(oauthClient, req, { state, nonce });

  req.session.tokenExchange = {
    subjectToken: tokenSet.access_token,
    subjectPreview: `${tokenSet.access_token?.slice(0, 24)}...`,
  };
  delete req.session.tokenExchangeOauth;
  res.redirect('/labs/token-exchange');
}));

router.post('/exchange-user-token', asyncHandler(async (req, res) => {
  const subjectToken = req.session.tokenExchange?.subjectToken;
  if (!subjectToken) {
    return res.status(400).render('error', {
      title: 'No subject token',
      message: 'Log in first to obtain a user access token to exchange.',
      details: null,
    });
  }

  const audience = req.body.audience || targetConfig.clientId || undefined;
  const scope = req.body.scope || undefined;

  const result = await exchangeToken({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    subjectToken,
    audience,
    scope,
    tokenAuthMethod: config.tokenAuthMethod,
  });

  req.session.tokenExchange.result = {
    token_type: result.token_type,
    expires_in: result.expires_in,
    scope: result.scope,
    issued_token_type: result.issued_token_type,
    access_token_preview: `${result.access_token?.slice(0, 24)}...`,
    exchanged_at: new Date().toISOString(),
  };
  res.redirect('/labs/token-exchange');
}));

router.post('/exchange-m2m-token', asyncHandler(async (req, res) => {
  const m2mToken = await clientCredentialsToken({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scope: req.body.scope || 'openid',
    tokenAuthMethod: config.tokenAuthMethod,
  });

  const result = await exchangeToken({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    subjectToken: m2mToken.access_token,
    audience: req.body.audience || targetConfig.clientId || undefined,
    tokenAuthMethod: config.tokenAuthMethod,
  });

  req.session.tokenExchange = req.session.tokenExchange || {};
  req.session.tokenExchange.result = {
    token_type: result.token_type,
    expires_in: result.expires_in,
    scope: result.scope,
    issued_token_type: result.issued_token_type,
    access_token_preview: `${result.access_token?.slice(0, 24)}...`,
    exchanged_at: new Date().toISOString(),
    source: 'client_credentials',
  };
  res.redirect('/labs/token-exchange');
}));

router.post('/clear', (req, res) => {
  delete req.session.tokenExchange;
  delete req.session.tokenExchangeOauth;
  res.redirect('/labs/token-exchange');
});

export default router;

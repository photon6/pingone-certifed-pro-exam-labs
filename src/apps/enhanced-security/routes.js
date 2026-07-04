import { Router } from 'express';
import { appConfig, isConfigured, missingConfigMessage } from '../../config/pingone.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import {
  createConfidentialClient,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  pushedAuthorizationRequest,
  generatePkce,
  generateState,
  generateNonce,
} from '../../lib/pingone-client.js';
import { getLab } from '../../lib/lab-meta.js';

const config = appConfig('ENHANCED_SECURITY', { path: '/labs/enhanced-security' });
const lab = getLab('enhanced-security');

const router = Router();

router.get('/', (req, res) => {
  const configured = isConfigured(config.clientId);
  res.render('enhanced-security-lab', {
    lab,
    configured,
    configError: missingConfigMessage('ENHANCED_SECURITY', config.clientId),
    redirectUri: config.redirectUri,
    user: req.session.enhancedSecurity?.userinfo || null,
    tokens: req.session.enhancedSecurity?.tokens ? summarizeTokens(req.session.enhancedSecurity.tokens) : null,
    authMethod: req.session.enhancedSecurity?.authMethod || null,
    hideTryIt: true,
  });
});

router.get('/login', asyncHandler(async (req, res) => {
  await startAuth(req, res, { usePar: false, acrValues: null });
}));

router.get('/login-par', asyncHandler(async (req, res) => {
  await startAuth(req, res, { usePar: true, acrValues: null });
}));

router.get('/login-stepup', asyncHandler(async (req, res) => {
  await startAuth(req, res, { usePar: true, acrValues: 'urn:pingone:loa:high' });
}));

async function startAuth(req, res, { usePar, acrValues }) {
  const oauthClient = await createConfidentialClient(config);
  const state = generateState();
  const nonce = generateNonce();
  const { code_verifier, code_challenge } = generatePkce();

  req.session.enhancedSecurityOauth = {
    state,
    nonce,
    code_verifier,
    authMethod: usePar ? (acrValues ? 'PAR + PKCE + Step-up' : 'PAR + PKCE') : 'PKCE only',
  };

  const authParams = {
    scope: 'openid profile',
    state,
    nonce,
    code_challenge,
    code_challenge_method: 'S256',
  };
  if (acrValues) authParams.acr_values = acrValues;

  if (usePar) {
    const parResponse = await pushedAuthorizationRequest(oauthClient, authParams);
    const url = buildAuthorizationUrl(oauthClient, {
      request_uri: parResponse.request_uri,
    });
    return res.redirect(url);
  }

  const url = buildAuthorizationUrl(oauthClient, authParams);
  res.redirect(url);
}

router.get('/callback', asyncHandler(async (req, res) => {
  const oauthClient = await createConfidentialClient(config);
  const { state, nonce, code_verifier, authMethod } = req.session.enhancedSecurityOauth || {};
  const tokenSet = await authorizationCodeGrant(oauthClient, req, {
    state,
    nonce,
    code_verifier,
  });
  const userinfo = await oauthClient.userinfo(tokenSet.access_token);

  req.session.enhancedSecurity = {
    tokens: tokenSet,
    userinfo,
    authMethod,
  };
  delete req.session.enhancedSecurityOauth;
  res.redirect('/labs/enhanced-security');
}));

router.post('/logout', (req, res) => {
  delete req.session.enhancedSecurity;
  delete req.session.enhancedSecurityOauth;
  res.redirect('/labs/enhanced-security');
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

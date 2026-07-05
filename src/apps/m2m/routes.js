import { Router } from 'express';
import { appConfig, isConfigured, missingConfigMessage } from '../../config/pingone.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { clientCredentialsToken } from '../../lib/pingone-client.js';
import { summarizeAccessToken } from '../../lib/jwt-display.js';
import { getLab } from '../../lib/lab-meta.js';

const config = appConfig('M2M');
const lab = getLab('m2m');

const router = Router();

router.get('/', (req, res) => {
  const configured = isConfigured(config.clientId);
  res.render('m2m-lab', {
    lab,
    configured,
    configError: missingConfigMessage('m2m', config.clientId, config.tokenAuthMethod),
    tokenAuthMethod: config.tokenAuthMethod,
    lastToken: req.session.m2m?.lastToken || null,
    hideTryIt: true,
  });
});

router.post('/token', asyncHandler(async (req, res) => {
  const scope = req.body.scope || 'openid';
  const tokenSet = await clientCredentialsToken({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scope,
    tokenAuthMethod: config.tokenAuthMethod,
  });

  req.session.m2m = {
    lastToken: {
      token_type: tokenSet.token_type,
      expires_in: tokenSet.expires_in,
      scope: tokenSet.scope,
      access_token: summarizeAccessToken(tokenSet.access_token),
      issued_at: new Date().toISOString(),
    },
    rawToken: tokenSet.access_token,
  };
  res.redirect('/labs/m2m');
}));

router.post('/clear', (req, res) => {
  delete req.session.m2m;
  res.redirect('/labs/m2m');
});

export default router;

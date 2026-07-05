import { Router } from 'express';
import { appConfig, isConfigured, missingConfigMessage, pingoneConfig } from '../../config/pingone.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { validateBearerToken } from '../../middleware/bearer-auth.js';
import { getLab } from '../../lib/lab-meta.js';

const config = appConfig('API_ACCESS');
const lab = getLab('api-access');

const router = Router();

router.get('/', (req, res) => {
  const configured = isConfigured(config.clientId);
  res.render('api-access-lab', {
    lab,
    configured,
    configError: missingConfigMessage('API_ACCESS', config.clientId),
    clientId: config.clientId,
    baseUrl: pingoneConfig.baseUrl,
  });
});

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
  const scopes = (req.tokenPayload.scope || '').split(' ');
  if (!scopes.includes('read:labs')) {
    return res.status(403).json({
      error: 'insufficient_scope',
      message: 'Token must include read:labs scope (configure in PingOne and request when obtaining token).',
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

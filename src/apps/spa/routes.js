import { Router } from 'express';
import { appConfig, isConfigured, missingConfigMessage, pingoneConfig } from '../../config/pingone.js';
import { getLab } from '../../lib/lab-meta.js';

const config = appConfig('SPA', { path: '/labs/spa' });
const lab = getLab('spa');

const router = Router();

router.get('/', (req, res) => {
  const configured = isConfigured(config.clientId);
  res.render('spa-lab', {
    lab,
    configured,
    configError: missingConfigMessage('SPA', config.clientId),
    redirectUri: config.redirectUri,
    clientId: config.clientId,
    issuer: pingoneConfig.issuer,
    authHost: pingoneConfig.authHost,
    environmentId: pingoneConfig.environmentId,
    hideTryIt: true,
  });
});

export default router;

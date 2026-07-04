import { Router } from 'express';
import { labs } from '../lib/lab-meta.js';
import { pingoneConfig } from '../config/pingone.js';

const router = Router();

const pingoneViewConfig = {
  environmentId: pingoneConfig.environmentId,
  region: pingoneConfig.region,
  issuer: pingoneConfig.issuer,
  baseUrl: pingoneConfig.baseUrl,
};

router.get('/', (req, res) => {
  res.render('home', {
    activeNav: 'home',
    pingoneConfig: pingoneViewConfig,
  });
});

router.get('/labs', (req, res) => {
  res.render('labs', {
    activeNav: 'oidc-labs',
    labs,
    pingoneConfig: pingoneViewConfig,
  });
});

export default router;

import express from 'express';
import session from 'express-session';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pingoneConfig } from './config/pingone.js';
import { navItems } from './lib/nav.js';
import indexRoutes from './routes/index.js';
import webAuthRoutes from './apps/web-auth/routes.js';
import mobileRoutes from './apps/mobile/routes.js';
import spaRoutes from './apps/spa/routes.js';
import apiAccessRoutes from './apps/api-access/routes.js';
import longSessionRoutes from './apps/long-session/routes.js';
import m2mRoutes from './apps/m2m/routes.js';
import deviceFlowRoutes from './apps/device-flow/routes.js';
import cibaRoutes from './apps/ciba/routes.js';
import tokenExchangeRoutes from './apps/token-exchange/routes.js';
import enhancedSecurityRoutes from './apps/enhanced-security/routes.js';
import { errorHandler } from './middleware/error-handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: pingoneConfig.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: pingoneConfig.baseUrl.startsWith('https'),
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

app.use((req, res, next) => {
  res.locals.baseUrl = pingoneConfig.baseUrl;
  res.locals.navItems = navItems;
  if (req.path === '/') {
    res.locals.activeNav = 'home';
  } else if (req.path === '/labs' || req.path.startsWith('/labs/')) {
    res.locals.activeNav = 'oidc-labs';
  } else {
    res.locals.activeNav = null;
  }
  next();
});

app.use('/', indexRoutes);
app.use('/labs/web-auth', webAuthRoutes);
app.use('/labs/mobile', mobileRoutes);
app.use('/labs/spa', spaRoutes);
app.use('/labs/api-access', apiAccessRoutes);
app.use('/labs/long-session', longSessionRoutes);
app.use('/labs/m2m', m2mRoutes);
app.use('/labs/device-flow', deviceFlowRoutes);
app.use('/labs/ciba', cibaRoutes);
app.use('/labs/token-exchange', tokenExchangeRoutes);
app.use('/labs/enhanced-security', enhancedSecurityRoutes);

app.use(errorHandler);

const pidFile = path.join(__dirname, '../.server.pid');
const server = app.listen(pingoneConfig.port, () => {
  fs.writeFileSync(pidFile, String(process.pid));
  console.log(`PingOne Exam Labs running at ${pingoneConfig.baseUrl}`);
  console.log(`Environment: ${pingoneConfig.environmentId || '(not configured)'}`);
  console.log(`Region: ${pingoneConfig.region}`);
});

function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  server.close(() => {
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

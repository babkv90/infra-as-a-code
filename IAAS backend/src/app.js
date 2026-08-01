import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { isAllowedCorsOrigin } from './utils/cors.js';

export const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedCorsOrigin(origin));
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma'],
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  }),
);
// Frequent, read-only status-polling GET routes the frontend hits on short fixed intervals while a
// deployment/pipeline run is active (deployment status every 2.2s, deployments list every 4s,
// GitHub Actions run/job-log status every 8s, notifications every 15s) — legitimate usage from a
// single active tab can exceed the default RATE_LIMIT_MAX on its own well within one window. These
// get POLLING_RATE_LIMIT_MAX instead of being counted against the tighter default limit that
// protects mutating/one-off routes.
const POLLING_ROUTE_PATTERNS = [
  /^\/api\/v1\/deployments$/,
  /^\/api\/v1\/deployments\/[^/]+$/,
  /^\/api\/v1\/deployments\/[^/]+\/github-run$/,
  /^\/api\/v1\/deployments\/[^/]+\/github-run\/jobs\/[^/]+\/logs$/,
  /^\/api\/v1\/app-pipelines\/[^/]+\/deployment-status$/,
  /^\/api\/v1\/notifications$/,
];

function isPollingRoute(req) {
  return req.method === 'GET' && POLLING_ROUTE_PATTERNS.some((pattern) => pattern.test(req.path));
}

app.use(
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skip: isPollingRoute,
  }),
);
app.use(
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.POLLING_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => !isPollingRoute(req),
  }),
);

if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'infraflow-backend' });
});

app.use('/api/v1', apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

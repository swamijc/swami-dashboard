import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import helmet from 'helmet';

import { getDb } from './db/database';
import { SQLiteSessionStore } from './db/sessionStore';
import { initScheduler } from './scheduler/cron';
import authRouter from './routes/auth';
import timesheetRouter from './routes/timesheet';
import adminRouter from './routes/admin';
import trackingRouter from './routes/tracking';
import jiraRouter from './routes/jira';
import releaseRouter from './routes/release';

const PORT = parseInt(process.env.PORT || '3001', 10);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

export function createApp() {
  const app = express();

  // ── Security middleware ──────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: false,  // handled by nginx in prod
    crossOriginEmbedderPolicy: false
  }));

  app.use(cors({
    origin: FRONTEND_URL,
    credentials: true,
    methods: ['GET','POST','PUT','DELETE','OPTIONS']
  }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ── Session ──────────────────────────────────────────────────────
  app.use(session({
    store: new SQLiteSessionStore(getDb()),
    secret: process.env.SESSION_SECRET || 'fallback-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000  // 8 hours
    }
  }));

  // ── Initialise DB ────────────────────────────────────────────────
  getDb();

  // ── Routes ───────────────────────────────────────────────────────
  app.use('/api/auth',      authRouter);
  app.use('/api/timesheet', timesheetRouter);
  app.use('/api/admin',     adminRouter);
  app.use('/api/tracking',  trackingRouter);
  app.use('/api/jira',      jiraRouter);
  app.use('/api/release',   releaseRouter);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), service: 'swami-dashboard-gateway' });
  });

  return app;
}

const app = createApp();

function startServer() {
  app.listen(PORT, () => {
  console.log(`\n🚀  Swami's Portfolio Dashboard — API Gateway`);
  console.log(`   Listening on http://localhost:${PORT}`);
  console.log(`   Frontend:     ${FRONTEND_URL}`);
  console.log(`   Environment:  ${process.env.NODE_ENV}\n`);
  initScheduler();
  });
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;

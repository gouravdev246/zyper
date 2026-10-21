import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { runsRouter } from './routes/runs.js';
import { approvalsRouter } from './routes/approvals.js';
import { connectionsRouter } from './routes/connections.js';
import { devicesRouter } from './routes/devices.js';
import { rulesRouter } from './routes/rules.js';
import { auditRouter } from './routes/audit.js';
import { conversationsRouter } from './routes/conversations.js';

export function createApp(): Express {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Mount API v1 Routes
  const apiV1 = express.Router();
  apiV1.use(healthRouter);
  apiV1.use(runsRouter);
  apiV1.use(approvalsRouter);
  apiV1.use(connectionsRouter);
  apiV1.use(devicesRouter);
  apiV1.use(rulesRouter);
  apiV1.use(auditRouter);
  apiV1.use(conversationsRouter);

  app.use('/api/v1', apiV1);

  // 404 Handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
      },
    });
  });

  // Global Error Handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: err.message || 'An unexpected error occurred',
      },
    });
  });

  return app;
}

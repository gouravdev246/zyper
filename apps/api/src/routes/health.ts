import { Router, Request, Response } from 'express';
import { HealthCheckResponse } from '@zyper/shared';

export const healthRouter = Router();

healthRouter.get('/health', (_req: Request, res: Response) => {
  const response: HealthCheckResponse = {
    status: 'ok',
    service: 'zyper-api',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };

  res.status(200).json(response);
});

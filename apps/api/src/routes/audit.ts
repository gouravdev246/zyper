import { Router, Request, Response } from 'express';

export const auditRouter = Router();

// GET /api/v1/audit-events
auditRouter.get('/audit-events', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: [],
  });
});

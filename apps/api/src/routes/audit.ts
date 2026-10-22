import { Router, Request, Response } from 'express';
import { toolExecutionService } from '../services/tool-execution.service.js';

export const auditRouter = Router();

// GET /api/v1/audit-events
auditRouter.get('/audit-events', async (_req: Request, res: Response) => {
  const events = toolExecutionService.getAuditEvents();
  res.json({
    success: true,
    data: events,
  });
});

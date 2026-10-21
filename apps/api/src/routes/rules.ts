import { Router, Request, Response } from 'express';
import { z } from 'zod';

export const rulesRouter = Router();

const createRuleSchema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  triggerType: z.enum(['schedule', 'event']),
  cronSchedule: z.string().optional(),
});

// GET /api/v1/automation-rules
rulesRouter.get('/automation-rules', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: [],
  });
});

// POST /api/v1/automation-rules
rulesRouter.post('/automation-rules', async (req: Request, res: Response) => {
  const parseResult = createRuleSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid automation rule payload',
        details: parseResult.error.format(),
      },
    });
    return;
  }

  res.status(201).json({
    success: true,
    data: {
      id: crypto.randomUUID(),
      ...parseResult.data,
      isEnabled: true,
      createdAt: new Date().toISOString(),
    },
  });
});

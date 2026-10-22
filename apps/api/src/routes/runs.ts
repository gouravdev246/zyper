import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { RunStatus } from '@zyper/shared';

export const runsRouter = Router();

const createRunSchema = z.object({
  goal: z.string().min(1, 'Goal is required'),
  conversationId: z.string().uuid().optional(),
});

// GET /api/v1/runs - list runs
runsRouter.get('/runs', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: [],
  });
});

// POST /api/v1/runs - create a run
runsRouter.post('/runs', async (req: Request, res: Response) => {
  const parseResult = createRunSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid run input parameters',
        details: parseResult.error.format(),
      },
    });
    return;
  }

  const { goal, conversationId } = parseResult.data;
  const mockRun = {
    id: crypto.randomUUID(),
    goal,
    conversationId: conversationId || null,
    status: RunStatus.PENDING,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  res.status(201).json({
    success: true,
    data: mockRun,
  });
});

// GET /api/v1/runs/:id - retrieve run
runsRouter.get('/runs/:id', async (req: Request, res: Response) => {
  const runId = String(req.params.id);
  res.json({
    success: true,
    data: {
      id: runId,
      status: RunStatus.PENDING,
      tasks: [],
    },
  });
});

// POST /api/v1/runs/:id/cancel - cancel run
runsRouter.post('/runs/:id/cancel', async (req: Request, res: Response) => {
  const runId = String(req.params.id);
  res.json({
    success: true,
    data: {
      id: runId,
      status: RunStatus.CANCELLED,
      cancelledAt: new Date().toISOString(),
    },
  });
});

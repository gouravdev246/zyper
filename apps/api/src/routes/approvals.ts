import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ApprovalStatus } from '@zyper/shared';

export const approvalsRouter = Router();

const approvalDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().optional(),
});

// GET /api/v1/approvals - list pending approvals
approvalsRouter.get('/approvals', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: [],
  });
});

// POST /api/v1/approvals/:id/decision - approve or reject
approvalsRouter.post('/approvals/:id/decision', async (req: Request, res: Response) => {
  const parseResult = approvalDecisionSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid decision payload. Must be APPROVED or REJECTED',
        details: parseResult.error.format(),
      },
    });
    return;
  }

  const { decision } = parseResult.data;
  res.json({
    success: true,
    data: {
      id: req.params.id,
      status: decision === 'APPROVED' ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
      decidedAt: new Date().toISOString(),
    },
  });
});

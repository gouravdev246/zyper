import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { policyService } from '../services/policy.service.js';

export const approvalsRouter = Router();

const approvalDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().optional(),
});

// GET /api/v1/approvals - list pending approvals
approvalsRouter.get('/approvals', async (_req: Request, res: Response) => {
  const pending = policyService.listPendingApprovals();
  res.json({
    success: true,
    data: pending,
  });
});

// POST /api/v1/approvals/:id/decision - approve or reject
approvalsRouter.post('/approvals/:id/decision', async (req: Request, res: Response) => {
  const approvalId = String(req.params.id);
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
  const updated = await policyService.recordDecision(approvalId, decision);
  if (!updated) {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Approval request ${approvalId} not found`,
      },
    });
    return;
  }

  res.json({
    success: true,
    data: updated,
  });
});

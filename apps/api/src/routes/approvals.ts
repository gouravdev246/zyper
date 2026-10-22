import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { policyService } from '../services/policy.service.js';
import { toolExecutionService } from '../services/tool-execution.service.js';
import { logger } from '../lib/logger.js';

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

// POST /api/v1/approvals/:id/decision - approve or reject and execute if approved
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

  // If approved, immediately execute the authorized tool action
  if (decision === 'APPROVED') {
    try {
      logger.info(`Executing approved tool action for ${updated.toolId} (approval: ${updated.id})`);
      const executionResult = await toolExecutionService.execute({
        toolId: updated.toolId,
        input: updated.actionPayload,
        runId: updated.runId,
        taskId: updated.taskId,
        approvalId: updated.id,
      });

      res.json({
        success: true,
        data: {
          ...updated,
          execution: executionResult,
        },
      });
      return;
    } catch (execErr: unknown) {
      const msg = execErr instanceof Error ? execErr.message : 'Tool execution error';
      logger.error({ err: execErr }, `Failed to execute approved action ${updated.toolId}`);
      res.status(500).json({
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: `Approved action failed to execute: ${msg}`,
        },
      });
      return;
    }
  }

  res.json({
    success: true,
    data: updated,
  });
});

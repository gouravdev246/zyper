import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { toolRegistry } from '../tools/registry.js';
import { toolExecutionService } from '../services/tool-execution.service.js';

export const toolsRouter = Router();

const executeToolSchema = z.object({
  toolId: z.string().min(1, 'Tool ID is required'),
  input: z.record(z.unknown()).default({}),
  runId: z.string().optional(),
  taskId: z.string().optional(),
  approvalId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

// GET /api/v1/tools - list registered tool contracts
toolsRouter.get('/tools', (_req: Request, res: Response) => {
  const tools = toolRegistry.list();
  res.json({
    success: true,
    data: tools,
  });
});

// POST /api/v1/tools/execute - execute a tool through the policy engine
toolsRouter.post('/tools/execute', async (req: Request, res: Response) => {
  const parseResult = executeToolSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid tool execution parameters',
        details: parseResult.error.format(),
      },
    });
    return;
  }

  const result = await toolExecutionService.execute(parseResult.data);
  res.status(result.status === 'REJECTED' ? 403 : 200).json({
    success: result.status === 'SUCCESS',
    data: result,
  });
});

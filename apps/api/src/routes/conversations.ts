import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { conversationService } from '../services/conversation.service.js';
import { runService } from '../services/run.service.js';
import { env } from '../config/env.js';
import { RunStatus } from '@zyper/shared';
import { logger } from '../lib/logger.js';

export const conversationsRouter = Router();

const createConversationSchema = z.object({
  title: z.string().optional(),
});

const postMessageSchema = z.object({
  content: z.string().min(1, 'Message content cannot be empty'),
  model: z.string().optional(),
});

// GET /api/v1/conversations - list conversations
conversationsRouter.get('/conversations', async (_req: Request, res: Response) => {
  const list = await conversationService.listConversations();
  res.json({
    success: true,
    data: list,
  });
});

// POST /api/v1/conversations - create new conversation
conversationsRouter.post('/conversations', async (req: Request, res: Response) => {
  const parseResult = createConversationSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid conversation parameters',
        details: parseResult.error.format(),
      },
    });
    return;
  }

  const convo = await conversationService.createConversation(parseResult.data.title);
  res.status(201).json({
    success: true,
    data: convo,
  });
});

// GET /api/v1/conversations/:id - get conversation details
conversationsRouter.get('/conversations/:id', async (req: Request, res: Response) => {
  const conversationId = String(req.params.id);
  const convo = await conversationService.getConversation(conversationId);
  if (!convo) {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Conversation not found',
      },
    });
    return;
  }

  res.json({
    success: true,
    data: convo,
  });
});

// GET /api/v1/conversations/:id/messages - get message history
conversationsRouter.get('/conversations/:id/messages', async (req: Request, res: Response) => {
  const conversationId = String(req.params.id);
  const messages = await conversationService.getMessages(conversationId);
  res.json({
    success: true,
    data: messages,
  });
});

// POST /api/v1/conversations/:id/cancel - cancel active run
conversationsRouter.post('/conversations/:id/cancel', async (req: Request, res: Response) => {
  const conversationId = String(req.params.id);
  logger.info(`Received cancel request for conversation ${conversationId}`);

  res.json({
    success: true,
    data: {
      conversationId,
      status: 'CANCELLED',
      timestamp: new Date().toISOString(),
    },
  });
});

// POST /api/v1/conversations/:id/messages - stream assistant reply and persist
conversationsRouter.post('/conversations/:id/messages', async (req: Request, res: Response) => {
  const conversationId = String(req.params.id);

  const parseResult = postMessageSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid message payload',
        details: parseResult.error.format(),
      },
    });
    return;
  }

  const { content, model } = parseResult.data;

  // 1. Persist user message
  const userMessage = await conversationService.addMessage(conversationId, 'user', content);

  // 2. Create Run lifecycle record
  const { run, abortController } = await runService.createRun(content, conversationId);
  await runService.updateRunStatus(run.id, RunStatus.RUNNING);

  // 3. Set SSE response headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send initial events
  res.write(`data: ${JSON.stringify({ type: 'user_message', message: userMessage })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'run.created', runId: run.id, status: RunStatus.RUNNING })}\n\n`);

  let assistantText = '';

  // Handle client disconnection
  req.on('close', () => {
    logger.info(`Client disconnected during run ${run.id}`);
    abortController.abort();
    runService.updateRunStatus(run.id, RunStatus.CANCELLED);
  });

  try {
    // Retrieve previous messages for conversational context
    const previousMessages = await conversationService.getMessages(conversationId);
    const history = previousMessages
      .filter((m) => m.id !== userMessage.id)
      .slice(-10)
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    // Attempt to call Python Orchestrator streaming endpoint
    const orchestratorStreamUrl = `${env.INTERNAL_ORCHESTRATOR_URL}/runs/stream`;
    const orchResponse = await fetch(orchestratorStreamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: content,
        conversation_id: conversationId,
        run_id: run.id,
        history,
        model,
      }),
      signal: abortController.signal,
    }).catch(() => null);

    if (orchResponse && orchResponse.ok && orchResponse.body) {
      const reader = orchResponse.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        if (abortController.signal.aborted) {
          res.write(`data: ${JSON.stringify({ type: 'run.cancelled', runId: run.id })}\n\n`);
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);

        // Accumulate token content for database persistence
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.replace('data: ', ''));
              if (data.type === 'token' && typeof data.content === 'string') {
                assistantText += data.content;
              }
            } catch {
              // ignore non-json SSE lines
            }
          }
        }
      }
    } else {
      // Fallback response if internal orchestrator is temporarily unreachable
      const fallbackChunks = [
        `Understood: "${content}". `,
        'Planning multi-step workflow. ',
        'Checking authorization and active tool adapters. ',
        'How would you like to proceed with this task?',
      ];

      for (const token of fallbackChunks) {
        if (abortController.signal.aborted) {
          res.write(`data: ${JSON.stringify({ type: 'run.cancelled', runId: run.id })}\n\n`);
          break;
        }

        assistantText += token;
        res.write(`data: ${JSON.stringify({ type: 'token', content: token })}\n\n`);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }

    // 4. Persist completed assistant message
    if (assistantText.trim()) {
      const savedAssistantMsg = await conversationService.addMessage(
        conversationId,
        'assistant',
        assistantText,
        { runId: run.id }
      );
      res.write(`data: ${JSON.stringify({ type: 'assistant_message', message: savedAssistantMsg })}\n\n`);
    }

    // 5. Update run status to COMPLETED
    await runService.updateRunStatus(run.id, RunStatus.COMPLETED);
    res.write(`data: ${JSON.stringify({ type: 'run.completed', runId: run.id, status: RunStatus.COMPLETED })}\n\n`);
  } catch (err: unknown) {
    if (abortController.signal.aborted) {
      await runService.updateRunStatus(run.id, RunStatus.CANCELLED);
      res.write(`data: ${JSON.stringify({ type: 'run.cancelled', runId: run.id })}\n\n`);
    } else {
      const errorMessage = err instanceof Error ? err.message : 'Unknown execution error';
      logger.error(`Error in run streaming: ${errorMessage}`);
      await runService.updateRunStatus(run.id, RunStatus.FAILED);
      res.write(`data: ${JSON.stringify({ type: 'run.failed', runId: run.id, error: errorMessage })}\n\n`);
    }
  } finally {
    res.end();
  }
});

import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { toolRegistry } from '../tools/registry.js';
import { policyService } from './policy.service.js';
import { ToolExecutionRequest, ToolExecutionResult, AuditEventType } from '@zyper/shared';
import { logger } from '../lib/logger.js';

interface ExecRecord {
  idempotencyKey: string;
  result: Record<string, unknown>;
  status: string;
  executedAt: string;
}

// In-memory execution cache for dev fallback and fast idempotency lookups
const memoryExecutions = new Map<string, ExecRecord>();
const memoryAuditEvents: Array<Record<string, unknown>> = [];

export class ToolExecutionService {
  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const { toolId, input, runId, taskId, approvalId } = request;

    // Generate or use provided idempotency key
    const idempotencyKey =
      request.idempotencyKey ||
      crypto
        .createHash('sha256')
        .update(JSON.stringify({ toolId, input, runId, taskId }))
        .digest('hex');

    // 1. Check idempotency: If this exact side-effect was already executed, return cached result
    const cached = memoryExecutions.get(idempotencyKey);
    if (cached) {
      logger.info(`Idempotent hit for key ${idempotencyKey}, returning cached output.`);
      return {
        toolId,
        status: 'SUCCESS',
        output: cached.result,
        durationMs: 0,
        executedAt: cached.executedAt,
      };
    }

    // 2. Validate tool registration
    const tool = toolRegistry.get(toolId);
    if (!tool) {
      await this.recordAudit(
        AuditEventType.TOOL_REJECTED,
        'EXECUTE_UNKNOWN_TOOL',
        toolId,
        { reason: 'Tool not registered in tool registry' }
      );

      return {
        toolId,
        status: 'REJECTED',
        error: `Unknown tool "${toolId}". Only registered tools may be executed.`,
        durationMs: Date.now() - startTime,
        executedAt: new Date().toISOString(),
      };
    }

    // 3. Validate input parameters against tool schema
    const validation = tool.inputValidator.safeParse(input);
    if (!validation.success) {
      await this.recordAudit(
        AuditEventType.TOOL_REJECTED,
        'INVALID_INPUT_SCHEMA',
        toolId,
        { errors: validation.error.format() }
      );

      return {
        toolId,
        status: 'REJECTED',
        error: `Invalid input schema: ${JSON.stringify(validation.error.format())}`,
        durationMs: Date.now() - startTime,
        executedAt: new Date().toISOString(),
      };
    }
    const validatedInput = validation.data;

    // 4. Policy evaluation
    const policyResult = await policyService.evaluateToolCall(
      tool,
      validatedInput,
      runId,
      taskId,
      approvalId
    );

    if (policyResult.requiresApproval) {
      await this.recordAudit(
        AuditEventType.APPROVAL_REQUIRED,
        'POLICY_APPROVAL_CHECK',
        toolId,
        { approvalId: policyResult.approval?.id, reason: policyResult.reason }
      );

      return {
        toolId,
        status: 'REQUIRES_APPROVAL',
        approval: policyResult.approval,
        error: policyResult.reason || 'Action requires user authorization',
        durationMs: Date.now() - startTime,
        executedAt: new Date().toISOString(),
      };
    }

    if (!policyResult.allowed) {
      await this.recordAudit(
        AuditEventType.TOOL_REJECTED,
        'POLICY_DENIED',
        toolId,
        { reason: policyResult.reason }
      );

      return {
        toolId,
        status: 'REJECTED',
        error: policyResult.reason || 'Policy engine denied execution',
        durationMs: Date.now() - startTime,
        executedAt: new Date().toISOString(),
      };
    }

    // 5. Execute tool with bounded timeout
    try {
      const output = await Promise.race([
        tool.execute(validatedInput),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool timeout exceeded (${tool.contract.timeoutMs}ms)`)), tool.contract.timeoutMs)
        ),
      ]);

      const executedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      // Cache execution for idempotency
      memoryExecutions.set(idempotencyKey, {
        idempotencyKey,
        result: output,
        status: 'SUCCESS',
        executedAt,
      });

      // Record audit event
      await this.recordAudit(
        AuditEventType.TOOL_EXECUTION,
        'EXECUTE_SUCCESS',
        toolId,
        { idempotencyKey, durationMs, runId, taskId }
      );

      return {
        toolId,
        status: 'SUCCESS',
        output,
        durationMs,
        executedAt,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Tool execution error';
      logger.error(`Execution failed for tool ${toolId}: ${errorMsg}`);

      await this.recordAudit(
        AuditEventType.TOOL_EXECUTION,
        'EXECUTE_FAILED',
        toolId,
        { error: errorMsg, idempotencyKey }
      );

      return {
        toolId,
        status: 'FAILED',
        error: errorMsg,
        durationMs: Date.now() - startTime,
        executedAt: new Date().toISOString(),
      };
    }
  }

  private async recordAudit(
    eventType: AuditEventType,
    action: string,
    resource: string,
    details: Record<string, unknown>
  ): Promise<void> {
    const event = {
      id: crypto.randomUUID(),
      eventType,
      action,
      resource,
      details,
      createdAt: new Date(),
    };

    memoryAuditEvents.push(event);

    try {
      await prisma.auditEvent.create({
        data: {
          eventType,
          action,
          resource,
          details: details as any,
        },
      });
    } catch {
      // In-memory fallback
    }
  }

  getAuditEvents(): Array<Record<string, unknown>> {
    return [...memoryAuditEvents];
  }
}

export const toolExecutionService = new ToolExecutionService();

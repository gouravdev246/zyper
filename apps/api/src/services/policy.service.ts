import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { ToolCategory, ApprovalStatus, ActionApproval } from '@zyper/shared';
import { ExecutableTool } from '../tools/registry.js';
import { logger } from '../lib/logger.js';

export interface PolicyEvaluation {
  allowed: boolean;
  requiresApproval: boolean;
  approval?: ActionApproval;
  reason?: string;
}

// In-memory approvals fallback cache
const memoryApprovals = new Map<string, ActionApproval>();

export class PolicyService {
  /**
   * Hashes the action payload to cryptographically bind the approval to the exact action arguments.
   * Any tampering or parameter variation will invalidate the approval.
   */
  hashPayload(toolId: string, payload: Record<string, unknown>): string {
    const sortedKeys = Object.keys(payload).sort();
    const sortedObj: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      sortedObj[key] = payload[key];
    }
    const serialized = JSON.stringify({ toolId, payload: sortedObj });
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  async evaluateToolCall(
    tool: ExecutableTool,
    input: Record<string, unknown>,
    runId?: string,
    taskId?: string,
    providedApprovalId?: string
  ): Promise<PolicyEvaluation> {
    const { category, requiresApprovalByDefault, id: toolId } = tool.contract;

    // 1. If tool is READ_ONLY, allow execution immediately
    if (category === ToolCategory.READ_ONLY) {
      return { allowed: true, requiresApproval: false };
    }

    // 2. If tool is PREPARATORY and does not require explicit approval by default
    if (category === ToolCategory.PREPARATORY && !requiresApprovalByDefault) {
      return { allowed: true, requiresApproval: false };
    }

    // 3. If approval was provided, verify it is APPROVED, not expired, and bound to exact payload
    if (providedApprovalId) {
      const approval = await this.getApproval(providedApprovalId);
      if (!approval) {
        return {
          allowed: false,
          requiresApproval: true,
          reason: `Approval with id ${providedApprovalId} not found`,
        };
      }

      if (approval.status !== ApprovalStatus.APPROVED) {
        return {
          allowed: false,
          requiresApproval: true,
          reason: `Approval status is ${approval.status}, not APPROVED`,
        };
      }

      const now = new Date();
      if (new Date(approval.expiresAt) < now) {
        approval.status = ApprovalStatus.EXPIRED;
        return {
          allowed: false,
          requiresApproval: true,
          reason: 'Approval has expired',
        };
      }

      // Verify payload binding
      const expectedHash = this.hashPayload(toolId, approval.actionPayload);
      const incomingHash = this.hashPayload(toolId, input);

      if (expectedHash !== incomingHash) {
        logger.warn(`Approval payload hash mismatch for tool ${toolId}`);
        return {
          allowed: false,
          requiresApproval: true,
          reason: 'Action arguments do not match approved payload',
        };
      }

      // Approval valid!
      return { allowed: true, requiresApproval: false, approval };
    }

    // 4. Consequential action without prior approval -> Create new ActionApproval request
    const approvalId = `appr-${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins expiry
    const description = `Authorization requested for ${tool.contract.name} (${toolId})`;

    const newApproval: ActionApproval = {
      id: approvalId,
      runId: runId || 'standalone-run',
      taskId: taskId || 'standalone-task',
      toolId,
      actionPayload: input,
      description,
      status: ApprovalStatus.PENDING,
      requestedAt: new Date().toISOString(),
      expiresAt,
    };

    try {
      if (runId && taskId) {
        await prisma.actionApproval.create({
          data: {
            id: approvalId,
            runId,
            taskId,
            toolId,
            actionPayload: input as any,
            description,
            status: ApprovalStatus.PENDING,
            expiresAt: new Date(expiresAt),
          },
        });
      }
    } catch {
      // In-memory fallback
      memoryApprovals.set(approvalId, newApproval);
    }
    memoryApprovals.set(approvalId, newApproval);

    return {
      allowed: false,
      requiresApproval: true,
      approval: newApproval,
      reason: 'Consequential action requires explicit user authorization',
    };
  }

  async getApproval(id: string): Promise<ActionApproval | null> {
    try {
      const record = await prisma.actionApproval.findUnique({
        where: { id },
      });
      if (!record) return memoryApprovals.get(id) || null;

      return {
        id: record.id,
        runId: record.runId,
        taskId: record.taskId,
        toolId: record.toolId,
        actionPayload: record.actionPayload as Record<string, unknown>,
        description: record.description,
        status: record.status as ApprovalStatus,
        requestedAt: record.requestedAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        decidedAt: record.decidedAt?.toISOString(),
        decidedBy: record.decidedBy || undefined,
      };
    } catch {
      return memoryApprovals.get(id) || null;
    }
  }

  async recordDecision(
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    decidedBy: string = 'Primary Operator'
  ): Promise<ActionApproval | null> {
    const status = decision === 'APPROVED' ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
    const decidedAt = new Date().toISOString();

    try {
      const updated = await prisma.actionApproval.update({
        where: { id },
        data: {
          status,
          decidedAt: new Date(decidedAt),
          decidedBy,
        },
      });

      const approval: ActionApproval = {
        id: updated.id,
        runId: updated.runId,
        taskId: updated.taskId,
        toolId: updated.toolId,
        actionPayload: updated.actionPayload as Record<string, unknown>,
        description: updated.description,
        status: updated.status as ApprovalStatus,
        requestedAt: updated.requestedAt.toISOString(),
        expiresAt: updated.expiresAt.toISOString(),
        decidedAt,
        decidedBy,
      };

      memoryApprovals.set(id, approval);
      return approval;
    } catch {
      const existing = memoryApprovals.get(id);
      if (!existing) return null;

      existing.status = status;
      existing.decidedAt = decidedAt;
      existing.decidedBy = decidedBy;
      return existing;
    }
  }

  listPendingApprovals(): ActionApproval[] {
    return Array.from(memoryApprovals.values()).filter(
      (a) => a.status === ApprovalStatus.PENDING && new Date(a.expiresAt) > new Date()
    );
  }
}

export const policyService = new PolicyService();

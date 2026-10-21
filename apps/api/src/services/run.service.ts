import { prisma } from '../lib/prisma.js';
import { RunStatus } from '@zyper/shared';
import { logger } from '../lib/logger.js';

export interface LocalRun {
  id: string;
  userId: string;
  conversationId: string | null;
  goal: string;
  status: RunStatus;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

const memoryRuns = new Map<string, LocalRun>();
const activeAbortControllers = new Map<string, AbortController>();

export class RunService {
  private defaultUserId = '00000000-0000-0000-0000-000000000001';

  async createRun(goal: string, conversationId?: string): Promise<{ run: LocalRun; abortController: AbortController }> {
    const abortController = new AbortController();

    try {
      const record = await prisma.run.create({
        data: {
          userId: this.defaultUserId,
          conversationId: conversationId || null,
          goal,
          status: RunStatus.PENDING,
        },
      });

      const run: LocalRun = {
        id: record.id,
        userId: record.userId,
        conversationId: record.conversationId,
        goal: record.goal,
        status: record.status as RunStatus,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        completedAt: record.completedAt,
      };

      activeAbortControllers.set(run.id, abortController);
      return { run, abortController };
    } catch {
      const runId = crypto.randomUUID();
      const run: LocalRun = {
        id: runId,
        userId: this.defaultUserId,
        conversationId: conversationId || null,
        goal,
        status: RunStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
      };

      memoryRuns.set(runId, run);
      activeAbortControllers.set(runId, abortController);
      return { run, abortController };
    }
  }

  async updateRunStatus(id: string, status: RunStatus): Promise<LocalRun | null> {
    const isCompleted = status === RunStatus.COMPLETED || status === RunStatus.CANCELLED || status === RunStatus.FAILED;

    try {
      const updated = await prisma.run.update({
        where: { id },
        data: {
          status,
          completedAt: isCompleted ? new Date() : undefined,
        },
      });

      if (isCompleted) {
        activeAbortControllers.delete(id);
      }

      return {
        id: updated.id,
        userId: updated.userId,
        conversationId: updated.conversationId,
        goal: updated.goal,
        status: updated.status as RunStatus,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        completedAt: updated.completedAt,
      };
    } catch {
      const run = memoryRuns.get(id);
      if (!run) return null;

      run.status = status;
      run.updatedAt = new Date();
      if (isCompleted) {
        run.completedAt = new Date();
        activeAbortControllers.delete(id);
      }

      return run;
    }
  }

  async cancelRun(id: string): Promise<LocalRun | null> {
    const controller = activeAbortControllers.get(id);
    if (controller) {
      logger.info(`Aborting active run ${id}`);
      controller.abort();
    }

    return this.updateRunStatus(id, RunStatus.CANCELLED);
  }

  async getRun(id: string): Promise<LocalRun | null> {
    try {
      const record = await prisma.run.findUnique({
        where: { id },
      });
      if (!record) return null;

      return {
        id: record.id,
        userId: record.userId,
        conversationId: record.conversationId,
        goal: record.goal,
        status: record.status as RunStatus,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        completedAt: record.completedAt,
      };
    } catch {
      return memoryRuns.get(id) || null;
    }
  }

  getAbortSignal(runId: string): AbortSignal | undefined {
    return activeAbortControllers.get(runId)?.signal;
  }
}

export const runService = new RunService();

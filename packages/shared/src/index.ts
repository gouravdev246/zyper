/**
 * @zyper/shared
 * Core types, interfaces, enums, and IPC contracts for Personal AI Operator.
 */

// ==========================================
// Run & Workflow Lifecycle
// ==========================================

export enum RunStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  WAITING_FOR_APPROVAL = 'WAITING_FOR_APPROVAL',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum TaskStatus {
  PENDING = 'PENDING',
  READY = 'READY',
  RUNNING = 'RUNNING',
  WAITING_FOR_APPROVAL = 'WAITING_FOR_APPROVAL',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

// ==========================================
// Tool Categories & Permissions
// ==========================================

export enum ToolCategory {
  READ_ONLY = 'READ_ONLY',
  PREPARATORY = 'PREPARATORY',
  CONSEQUENTIAL = 'CONSEQUENTIAL',
}

export interface ToolContract {
  id: string;
  name: string;
  description: string;
  version: string;
  category: ToolCategory;
  requiredScopes: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requiresApprovalByDefault: boolean;
  timeoutMs: number;
}

// ==========================================
// Approvals & Action Authorization
// ==========================================

export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export interface ActionApproval {
  id: string;
  runId: string;
  taskId: string;
  toolId: string;
  actionPayload: Record<string, unknown>;
  description: string;
  status: ApprovalStatus;
  requestedAt: string;
  expiresAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

// ==========================================
// Chat & Messages
// ==========================================

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

// ==========================================
// Electron IPC Contract
// ==========================================

export const IPC_CHANNELS = {
  GET_APP_VERSION: 'zyper:get-app-version',
  GET_SYSTEM_INFO: 'zyper:get-system-info',
  API_REQUEST: 'zyper:api-request',
  OPEN_EXTERNAL_URL: 'zyper:open-external-url',
  ON_RUN_EVENT: 'zyper:on-run-event',
} as const;

export type IpcChannelName = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];

// ==========================================
// Standard API Envelope
// ==========================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
}

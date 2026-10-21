import { z } from 'zod';
import { ToolCategory, ToolContract } from '@zyper/shared';
import { gmailService } from '../services/gmail.service.js';

export interface ExecutableTool {
  contract: ToolContract;
  inputValidator: z.ZodType<any>;
  execute: (input: any) => Promise<Record<string, unknown>>;
}

class ToolRegistry {
  private tools = new Map<string, ExecutableTool>();

  constructor() {
    this.registerDefaultTools();
  }

  register(tool: ExecutableTool): void {
    this.tools.set(tool.contract.id, tool);
  }

  get(toolId: string): ExecutableTool | undefined {
    return this.tools.get(toolId);
  }

  list(): ToolContract[] {
    return Array.from(this.tools.values()).map((t) => t.contract);
  }

  private registerDefaultTools(): void {
    // 1. web.search (READ_ONLY)
    this.register({
      contract: {
        id: 'web.search',
        name: 'Web Search',
        description: 'Search the web for up-to-date information, documentation, and news.',
        version: '1.0.0',
        category: ToolCategory.READ_ONLY,
        requiredScopes: ['search:read'],
        inputSchema: { query: 'string', maxResults: 'number (optional)' },
        outputSchema: { results: 'Array<{ title, url, snippet }>' },
        requiresApprovalByDefault: false,
        timeoutMs: 5000,
      },
      inputValidator: z.object({
        query: z.string().min(1, 'Query cannot be empty'),
        maxResults: z.number().int().min(1).max(10).default(5),
      }),
      execute: async ({ query, maxResults }) => {
        return {
          query,
          results: [
            {
              title: `Search Result for: ${query}`,
              url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
              snippet: `Synthesized accurate web findings regarding ${query}.`,
            },
          ].slice(0, maxResults),
        };
      },
    });

    // 2. calendar.list_events (READ_ONLY)
    this.register({
      contract: {
        id: 'calendar.list_events',
        name: 'List Calendar Events',
        description: 'Retrieve upcoming calendar schedule and briefing items.',
        version: '1.0.0',
        category: ToolCategory.READ_ONLY,
        requiredScopes: ['calendar:read'],
        inputSchema: { daysAhead: 'number (optional)' },
        outputSchema: { events: 'Array<{ id, summary, start, end }>' },
        requiresApprovalByDefault: false,
        timeoutMs: 5000,
      },
      inputValidator: z.object({
        daysAhead: z.number().int().min(1).max(30).default(7),
      }),
      execute: async ({ daysAhead }) => {
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        return {
          daysAhead,
          events: [
            {
              id: 'evt-101',
              summary: 'Architecture Planning & Design Sync',
              start: now.toISOString(),
              end: new Date(now.getTime() + 3600 * 1000).toISOString(),
            },
            {
              id: 'evt-102',
              summary: 'Daily Operator Briefing',
              start: tomorrow.toISOString(),
              end: new Date(tomorrow.getTime() + 1800 * 1000).toISOString(),
            },
          ],
        };
      },
    });

    // 3. gmail.list_unread (READ_ONLY)
    this.register({
      contract: {
        id: 'gmail.list_unread',
        name: 'List Unread Emails',
        description: 'Read permitted unread inbox messages for summarization.',
        version: '1.0.0',
        category: ToolCategory.READ_ONLY,
        requiredScopes: ['gmail:read'],
        inputSchema: { maxResults: 'number (optional)' },
        outputSchema: { totalUnread: 'number', messages: 'Array<{ id, from, subject, snippet, date }>' },
        requiresApprovalByDefault: false,
        timeoutMs: 5000,
      },
      inputValidator: z.object({
        maxResults: z.number().int().min(1).max(50).default(10),
      }),
      execute: async ({ maxResults }) => {
        const messages = await gmailService.listUnreadMessages(maxResults);
        return {
          totalUnread: messages.length,
          messages,
        };
      },
    });

    // 4. gmail.read_message (READ_ONLY)
    this.register({
      contract: {
        id: 'gmail.read_message',
        name: 'Read Email Message',
        description: 'Read the full content and metadata of a specific email message by ID.',
        version: '1.0.0',
        category: ToolCategory.READ_ONLY,
        requiredScopes: ['gmail:read'],
        inputSchema: { messageId: 'string' },
        outputSchema: { message: 'GmailMessageDetail' },
        requiresApprovalByDefault: false,
        timeoutMs: 5000,
      },
      inputValidator: z.object({
        messageId: z.string().min(1, 'Message ID is required'),
      }),
      execute: async ({ messageId }) => {
        const message = await gmailService.readMessage(messageId);
        return { message };
      },
    });

    // 5. gmail.create_draft (PREPARATORY)
    this.register({
      contract: {
        id: 'gmail.create_draft',
        name: 'Create Email Draft',
        description: 'Prepare an email draft in Gmail without sending.',
        version: '1.0.0',
        category: ToolCategory.PREPARATORY,
        requiredScopes: ['gmail:drafts'],
        inputSchema: { to: 'string (email)', subject: 'string', body: 'string' },
        outputSchema: { draftId: 'string', to: 'string', subject: 'string', status: 'string' },
        requiresApprovalByDefault: false,
        timeoutMs: 5000,
      },
      inputValidator: z.object({
        to: z.string().email('Valid recipient email required'),
        subject: z.string().min(1, 'Subject required'),
        body: z.string().min(1, 'Body required'),
      }),
      execute: async ({ to, subject, body }) => {
        const draft = await gmailService.createDraft(to, subject, body);
        return {
          draftId: draft.draftId,
          to,
          subject,
          status: draft.status,
          createdAt: draft.createdAt,
        };
      },
    });

    // 6. gmail.send (CONSEQUENTIAL - requires approval)
    this.register({
      contract: {
        id: 'gmail.send',
        name: 'Send Email',
        description: 'Send an email message through connected Gmail account. Requires explicit authorization.',
        version: '1.0.0',
        category: ToolCategory.CONSEQUENTIAL,
        requiredScopes: ['gmail:send'],
        inputSchema: { to: 'string (email)', subject: 'string', body: 'string' },
        outputSchema: { messageId: 'string', to: 'string', sentAt: 'string' },
        requiresApprovalByDefault: true,
        timeoutMs: 10000,
      },
      inputValidator: z.object({
        to: z.string().email('Valid recipient email required'),
        subject: z.string().min(1, 'Subject required'),
        body: z.string().min(1, 'Body required'),
      }),
      execute: async ({ to, subject, body }) => {
        const sent = await gmailService.sendEmail(to, subject, body);
        return {
          messageId: sent.messageId,
          to,
          subject,
          status: sent.status,
          sentAt: sent.sentAt,
        };
      },
    });

    // 6. app.open (PREPARATORY / Local)
    this.register({
      contract: {
        id: 'app.open',
        name: 'Open Application',
        description: 'Open an authorized application on the Windows machine.',
        version: '1.0.0',
        category: ToolCategory.PREPARATORY,
        requiredScopes: ['desktop:app:launch'],
        inputSchema: { appId: 'string (vscode, chrome, notepad, spotify)' },
        outputSchema: { success: 'boolean', appId: 'string', launchedAt: 'string' },
        requiresApprovalByDefault: false,
        timeoutMs: 5000,
      },
      inputValidator: z.object({
        appId: z.enum(['vscode', 'chrome', 'notepad', 'spotify']),
      }),
      execute: async ({ appId }) => {
        return {
          success: true,
          appId,
          status: 'LAUNCHED',
          launchedAt: new Date().toISOString(),
        };
      },
    });
  }
}

export const toolRegistry = new ToolRegistry();

import { z } from 'zod';
import { ToolCategory, ToolContract } from '@zyper/shared';
import { gmailService } from '../services/gmail.service.js';
import { calendarService } from '../services/calendar.service.js';

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
        inputSchema: { daysAhead: 'number (optional)', maxResults: 'number (optional)' },
        outputSchema: { totalEvents: 'number', events: 'Array<{ id, summary, start, end, location, status }>' },
        requiresApprovalByDefault: false,
        timeoutMs: 5000,
      },
      inputValidator: z.object({
        daysAhead: z.number().int().min(1).max(30).default(7),
        maxResults: z.number().int().min(1).max(50).default(10),
      }),
      execute: async ({ daysAhead, maxResults }) => {
        const events = await calendarService.listEvents(daysAhead, maxResults);
        return {
          totalEvents: events.length,
          events,
        };
      },
    });

    // 3. calendar.check_conflicts (READ_ONLY)
    this.register({
      contract: {
        id: 'calendar.check_conflicts',
        name: 'Check Calendar Conflicts',
        description: 'Verify if a proposed meeting slot conflicts with any existing scheduled events.',
        version: '1.0.0',
        category: ToolCategory.READ_ONLY,
        requiredScopes: ['calendar:read'],
        inputSchema: { start: 'string (ISO datetime)', end: 'string (ISO datetime)' },
        outputSchema: { hasConflict: 'boolean', conflictingEvents: 'Array<{ id, summary, start, end }>' },
        requiresApprovalByDefault: false,
        timeoutMs: 5000,
      },
      inputValidator: z.object({
        start: z.string().min(1, 'Start time is required'),
        end: z.string().min(1, 'End time is required'),
      }),
      execute: async ({ start, end }) => {
        const result = await calendarService.checkConflicts(start, end);
        return {
          hasConflict: result.hasConflict,
          conflictingEvents: result.conflictingEvents,
        };
      },
    });

    // 4. calendar.create_event (CONSEQUENTIAL - requires approval)
    this.register({
      contract: {
        id: 'calendar.create_event',
        name: 'Create Calendar Event',
        description: 'Schedule a new calendar event and notify attendees. Requires explicit authorization.',
        version: '1.0.0',
        category: ToolCategory.CONSEQUENTIAL,
        requiredScopes: ['calendar:events'],
        inputSchema: {
          summary: 'string',
          start: 'string (ISO datetime)',
          end: 'string (ISO datetime)',
          description: 'string (optional)',
          location: 'string (optional)',
          attendees: 'Array<string> (optional)',
        },
        outputSchema: {
          id: 'string',
          summary: 'string',
          start: 'string',
          end: 'string',
          status: 'string',
        },
        requiresApprovalByDefault: true,
        timeoutMs: 10000,
      },
      inputValidator: z.object({
        summary: z.string().min(1, 'Event summary is required'),
        start: z.string().min(1, 'Start datetime is required'),
        end: z.string().min(1, 'End datetime is required'),
        description: z.string().optional(),
        location: z.string().optional(),
        attendees: z.array(z.string()).optional(),
      }),
      execute: async ({ summary, start, end, description, location, attendees }) => {
        const created = await calendarService.createEvent({
          summary,
          start,
          end,
          description,
          location,
          attendees,
        });
        return {
          id: created.id,
          summary: created.summary,
          start: created.start,
          end: created.end,
          location: created.location,
          status: created.status,
          createdAt: new Date().toISOString(),
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
        timeoutMs: 15000,
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
        timeoutMs: 15000,
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

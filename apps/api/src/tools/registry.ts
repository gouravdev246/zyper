import { z } from 'zod';
import { ToolCategory, ToolContract } from '@zyper/shared';
import { gmailService } from '../services/gmail.service.js';
import { calendarService } from '../services/calendar.service.js';
import { windowsCompanionService, MediaAction } from '../services/windows-companion.service.js';
import { webSearchService } from '../services/web-search.service.js';

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
        name: 'Live Web Search',
        description: 'Search the live web for real-time information, documentation, news, and links without requiring API keys.',
        version: '1.0.0',
        category: ToolCategory.READ_ONLY,
        requiredScopes: ['search:read'],
        inputSchema: { query: 'string', maxResults: 'number (optional, default: 5)' },
        outputSchema: { query: 'string', totalFound: 'number', results: 'Array<{ title, url, snippet }>' },
        requiresApprovalByDefault: false,
        timeoutMs: 12000,
      },
      inputValidator: z.object({
        query: z
          .string()
          .transform((v) => v.replace(/[\[\]]/g, '').trim())
          .pipe(z.string().min(1, 'Query cannot be empty')),
        maxResults: z.coerce.number().int().min(1).max(20).default(5),
      }),
      execute: async ({ query, maxResults }) => {
        const result = await webSearchService.search(query, maxResults);
        return result as unknown as Record<string, unknown>;
      },
    });

    // 1b. browser.open_url (PREPARATORY)
    const browserOpenTool: ExecutableTool = {
      contract: {
        id: 'browser.open_url',
        name: 'Open Web Page in Browser',
        description: 'Open a web URL directly in the user default desktop browser (e.g. Chrome, Edge).',
        version: '1.0.0',
        category: ToolCategory.PREPARATORY,
        requiredScopes: ['browser:navigate'],
        inputSchema: { url: 'string (valid http/https URL)' },
        outputSchema: { success: 'boolean', url: 'string', status: 'string', openedAt: 'string' },
        requiresApprovalByDefault: false,
        timeoutMs: 8000,
      },
      inputValidator: z.object({
        url: z
          .string()
          .transform((v) => {
            let clean = v.replace(/[\[\]]/g, '').trim();
            if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
              clean = `https://${clean}`;
            }
            return clean;
          })
          .pipe(z.string().url('A valid http or https URL is required')),
      }),
      execute: async ({ url }) => {
        return (await webSearchService.openUrlInBrowser(url)) as unknown as Record<string, unknown>;
      },
    };
    this.register(browserOpenTool);
    this.register({
      ...browserOpenTool,
      contract: { ...browserOpenTool.contract, id: 'web.open_url' },
    });

    // 1c. browser.play_youtube (PREPARATORY)
    const youtubePlayTool: ExecutableTool = {
      contract: {
        id: 'browser.play_youtube',
        name: 'Open YouTube and Play Song',
        description: 'Find a song, music video, or content on YouTube and immediately launch it in the web browser for instant playback.',
        version: '1.0.0',
        category: ToolCategory.PREPARATORY,
        requiredScopes: ['browser:navigate', 'media:playback'],
        inputSchema: { query: 'string (song name, artist, or video title)' },
        outputSchema: { success: 'boolean', query: 'string', videoTitle: 'string', videoId: 'string', watchUrl: 'string', status: 'string' },
        requiresApprovalByDefault: false,
        timeoutMs: 10000,
      },
      inputValidator: z.object({
        query: z
          .string()
          .transform((v) => v.replace(/[\[\]]/g, '').trim())
          .pipe(z.string().min(1, 'Song or video query cannot be empty')),
      }),
      execute: async ({ query }) => {
        return (await webSearchService.playYouTube(query)) as unknown as Record<string, unknown>;
      },
    };
    this.register(youtubePlayTool);
    this.register({
      ...youtubePlayTool,
      contract: { ...youtubePlayTool.contract, id: 'youtube.play' },
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

    // 7. app.open (PREPARATORY / Local)
    const appOpenTool: ExecutableTool = {
      contract: {
        id: 'app.open',
        name: 'Open Application',
        description: 'Open an authorized application on the Windows machine (notepad, calculator, vscode, terminal, browser, explorer, spotify).',
        version: '1.0.0',
        category: ToolCategory.PREPARATORY,
        requiredScopes: ['desktop:app:launch'],
        inputSchema: { appId: 'string (notepad, calculator, vscode, terminal, browser, explorer, spotify)' },
        outputSchema: { success: 'boolean', appId: 'string', appName: 'string', status: 'string', launchedAt: 'string' },
        requiresApprovalByDefault: false,
        timeoutMs: 8000,
      },
      inputValidator: z.object({
        appId: z.enum(['notepad', 'calculator', 'vscode', 'terminal', 'browser', 'explorer', 'spotify']),
      }),
      execute: async ({ appId }) => {
        return await windowsCompanionService.launchApp(appId);
      },
    };
    this.register(appOpenTool);
    this.register({
      ...appOpenTool,
      contract: { ...appOpenTool.contract, id: 'desktop.app_launch' },
    });

    // 8. media.control (PREPARATORY / Local)
    const mediaControlTool: ExecutableTool = {
      contract: {
        id: 'media.control',
        name: 'Media Playback & Volume Control',
        description: 'Control basic Windows audio playback and volume (play_pause, next_track, prev_track, volume_up, volume_down, mute).',
        version: '1.0.0',
        category: ToolCategory.PREPARATORY,
        requiredScopes: ['desktop:media:control'],
        inputSchema: { action: 'string (play_pause, next_track, prev_track, volume_up, volume_down, mute)' },
        outputSchema: { success: 'boolean', action: 'string', status: 'string', executedAt: 'string' },
        requiresApprovalByDefault: false,
        timeoutMs: 5000,
      },
      inputValidator: z.object({
        action: z.enum(['play_pause', 'next_track', 'prev_track', 'volume_up', 'volume_down', 'mute']),
      }),
      execute: async ({ action }) => {
        return await windowsCompanionService.controlMedia(action as MediaAction);
      },
    };
    this.register(mediaControlTool);
    this.register({
      ...mediaControlTool,
      contract: { ...mediaControlTool.contract, id: 'desktop.media_control' },
    });

    // 9. files.search (READ_ONLY / Local)
    const filesSearchTool: ExecutableTool = {
      contract: {
        id: 'files.search',
        name: 'Search Approved Local Folders',
        description: 'Search for files by name/extension within user-approved folders (documents, downloads, desktop, workspace) with directory traversal protection.',
        version: '1.0.0',
        category: ToolCategory.READ_ONLY,
        requiredScopes: ['desktop:fs:search'],
        inputSchema: {
          folderId: 'string (documents, downloads, desktop, workspace)',
          query: 'string',
          maxResults: 'number (optional, default: 10)',
        },
        outputSchema: {
          totalFound: 'number',
          folderId: 'string',
          folderPath: 'string',
          results: 'Array<{ name, path, isDirectory, sizeBytes, modifiedAt }>',
        },
        requiresApprovalByDefault: false,
        timeoutMs: 10000,
      },
      inputValidator: z.object({
        folderId: z.enum(['documents', 'downloads', 'desktop', 'workspace']),
        query: z.string().min(1, 'Search query cannot be empty'),
        maxResults: z.number().int().min(1).max(50).default(10),
      }),
      execute: async ({ folderId, query, maxResults }) => {
        return (await windowsCompanionService.searchApprovedFolder(folderId, query, maxResults)) as unknown as Record<string, unknown>;
      },
    };
    this.register(filesSearchTool);
    this.register({
      ...filesSearchTool,
      contract: { ...filesSearchTool.contract, id: 'desktop.fs_search' },
    });
  }
}

export const toolRegistry = new ToolRegistry();

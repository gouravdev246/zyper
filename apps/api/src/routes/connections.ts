import { Router, Request, Response } from 'express';
import { gmailService } from '../services/gmail.service.js';
import { calendarService } from '../services/calendar.service.js';
import { windowsCompanionService } from '../services/windows-companion.service.js';

export const connectionsRouter = Router();

// GET /api/v1/connections - list integrations with live provider statuses
connectionsRouter.get('/connections', async (_req: Request, res: Response) => {
  const [gmailStatus, calendarStatus, companionStatus] = await Promise.all([
    gmailService.getConnectionStatus(),
    calendarService.getConnectionStatus(),
    windowsCompanionService.getConnectionStatus(),
  ]);

  res.json({
    success: true,
    data: [
      {
        provider: 'gmail',
        name: 'Gmail',
        status: gmailStatus.connected ? 'CONNECTED' : 'DISCONNECTED',
        scopes: gmailStatus.scopes,
        lastSyncAt: gmailStatus.lastSyncAt,
        description: 'Read unread emails, summarize, create drafts, and send authorized messages.',
      },
      {
        provider: 'google_calendar',
        name: 'Google Calendar',
        status: calendarStatus.connected ? 'CONNECTED' : 'DISCONNECTED',
        scopes: calendarStatus.scopes,
        lastSyncAt: calendarStatus.lastSyncAt,
        description: 'Schedule briefings, inspect calendar conflicts, and prepare agenda reminders.',
      },
      {
        provider: 'x',
        name: 'X (Twitter)',
        status: 'DISCONNECTED',
        scopes: ['tweet.read', 'tweet.write', 'users.read'],
        description: 'Topic research, feed monitoring, and approved draft publishing.',
      },
      {
        provider: 'web_browser',
        name: 'Web Search & Browser Player',
        status: 'CONNECTED',
        scopes: ['search:read', 'browser:navigate', 'media:playback'],
        description: 'Live DuckDuckGo web search, YouTube instant music video autoplay, and default browser URL launcher.',
      },
      {
        provider: 'windows_companion',
        name: 'Windows Local Companion',
        status: companionStatus.connected ? 'CONNECTED' : companionStatus.status === 'REVOKED' ? 'REVOKED' : 'DISCONNECTED',
        scopes: companionStatus.scopes,
        lastSyncAt: companionStatus.lastSeenAt,
        deviceName: companionStatus.deviceName,
        approvedFolders: companionStatus.approvedFolders,
        whitelistedApps: companionStatus.whitelistedApps,
        description: 'Native desktop companion: application launching, folder search, and media control.',
      },
    ],
  });
});

// ==========================================
// Gmail OAuth Routes
// ==========================================

// GET /api/v1/connections/gmail/auth-url
connectionsRouter.get('/connections/gmail/auth-url', (req: Request, res: Response) => {
  const redirectUri = req.query.redirectUri as string | undefined;
  const authUrl = gmailService.getAuthUrl(redirectUri);

  res.json({
    success: true,
    data: {
      provider: 'gmail',
      authUrl,
    },
  });
});

// POST /api/v1/connections/gmail/callback
connectionsRouter.post('/connections/gmail/callback', async (req: Request, res: Response) => {
  try {
    const { code, redirectUri } = req.body;
    if (!code) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Authorization code is required' },
      });
    }

    const result = await gmailService.handleCallback(code, redirectUri);
    return res.json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown OAuth error';
    return res.status(500).json({
      success: false,
      error: { code: 'OAUTH_EXCHANGE_FAILED', message: msg },
    });
  }
});

// GET /api/v1/connections/gmail/callback - support browser OAuth redirects
connectionsRouter.get('/connections/gmail/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    if (!code) {
      return res.status(400).send('Authorization code missing');
    }

    await gmailService.handleCallback(code);
    return res.send(`
      <html>
        <body style="background:#0b0f17;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
          <div style="text-align:center;padding:32px;background:#131b2e;border-radius:12px;border:1px solid rgba(255,255,255,0.1);">
            <h2 style="color:#4ade80;">Google Connected Successfully</h2>
            <p style="color:#94a3b8;">Your account integration is active. You may close this window and return to the Zyper Desktop application.</p>
          </div>
        </body>
      </html>
    `);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown OAuth error';
    return res.status(500).send(`OAuth Error: ${msg}`);
  }
});

// POST /api/v1/connections/gmail/disconnect
connectionsRouter.post('/connections/gmail/disconnect', async (_req: Request, res: Response) => {
  await gmailService.disconnect();
  res.json({
    success: true,
    data: {
      provider: 'gmail',
      status: 'DISCONNECTED',
      revokedAt: new Date().toISOString(),
    },
  });
});

// POST /api/v1/connections/gmail/mock-toggle
connectionsRouter.post('/connections/gmail/mock-toggle', (req: Request, res: Response) => {
  const { connected } = req.body;
  gmailService.setMockConnected(Boolean(connected));
  res.json({
    success: true,
    data: {
      provider: 'gmail',
      connected: Boolean(connected),
    },
  });
});

// ==========================================
// Google Calendar OAuth Routes
// ==========================================

// GET /api/v1/connections/google_calendar/auth-url
connectionsRouter.get('/connections/google_calendar/auth-url', (req: Request, res: Response) => {
  const redirectUri = req.query.redirectUri as string | undefined;
  const authUrl = calendarService.getAuthUrl(redirectUri);

  res.json({
    success: true,
    data: {
      provider: 'google_calendar',
      authUrl,
    },
  });
});

// POST /api/v1/connections/google_calendar/callback
connectionsRouter.post('/connections/google_calendar/callback', async (req: Request, res: Response) => {
  try {
    const { code, redirectUri } = req.body;
    if (!code) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Authorization code is required' },
      });
    }

    const result = await calendarService.handleCallback(code, redirectUri);
    return res.json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown OAuth error';
    return res.status(500).json({
      success: false,
      error: { code: 'OAUTH_EXCHANGE_FAILED', message: msg },
    });
  }
});

// GET /api/v1/connections/google_calendar/callback - support browser OAuth redirects
connectionsRouter.get('/connections/google_calendar/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    if (!code) {
      return res.status(400).send('Authorization code missing');
    }

    await calendarService.handleCallback(code);
    return res.send(`
      <html>
        <body style="background:#0b0f17;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
          <div style="text-align:center;padding:32px;background:#131b2e;border-radius:12px;border:1px solid rgba(255,255,255,0.1);">
            <h2 style="color:#60a5fa;">Google Calendar Connected Successfully</h2>
            <p style="color:#94a3b8;">You may close this window and return to the Zyper Desktop application.</p>
          </div>
        </body>
      </html>
    `);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown OAuth error';
    return res.status(500).send(`OAuth Error: ${msg}`);
  }
});

// POST /api/v1/connections/google_calendar/disconnect
connectionsRouter.post('/connections/google_calendar/disconnect', async (_req: Request, res: Response) => {
  await calendarService.disconnect();
  res.json({
    success: true,
    data: {
      provider: 'google_calendar',
      status: 'DISCONNECTED',
      revokedAt: new Date().toISOString(),
    },
  });
});

// POST /api/v1/connections/google_calendar/mock-toggle
connectionsRouter.post('/connections/google_calendar/mock-toggle', (req: Request, res: Response) => {
  const { connected } = req.body;
  calendarService.setMockConnected(Boolean(connected));
  res.json({
    success: true,
    data: {
      provider: 'google_calendar',
      connected: Boolean(connected),
    },
  });
});

// ==========================================
// Windows Local Companion Routes
// ==========================================

// GET /api/v1/connections/windows_companion/status
connectionsRouter.get('/connections/windows_companion/status', async (_req: Request, res: Response) => {
  const status = await windowsCompanionService.getConnectionStatus();
  res.json({
    success: true,
    data: status,
  });
});

// POST /api/v1/connections/windows_companion/pair
connectionsRouter.post('/connections/windows_companion/pair', async (req: Request, res: Response) => {
  const { deviceName } = req.body;
  const result = await windowsCompanionService.pairDevice(deviceName);
  res.json({
    success: true,
    data: result,
  });
});

// POST /api/v1/connections/windows_companion/revoke
connectionsRouter.post('/connections/windows_companion/revoke', async (_req: Request, res: Response) => {
  const result = await windowsCompanionService.revokeDevice();
  res.json({
    success: true,
    data: result,
  });
});

// POST /api/v1/connections/windows_companion/mock-toggle
connectionsRouter.post('/connections/windows_companion/mock-toggle', (req: Request, res: Response) => {
  const { connected } = req.body;
  windowsCompanionService.setMockConnected(Boolean(connected));
  res.json({
    success: true,
    data: {
      provider: 'windows_companion',
      connected: Boolean(connected),
    },
  });
});

// DELETE /api/v1/connections/:provider - generic revoke endpoint
connectionsRouter.delete('/connections/:provider', async (req: Request, res: Response) => {
  const { provider } = req.params;
  if (provider === 'gmail') {
    await gmailService.disconnect();
  } else if (provider === 'google_calendar') {
    await calendarService.disconnect();
  } else if (provider === 'windows_companion') {
    await windowsCompanionService.revokeDevice();
  }

  res.json({
    success: true,
    data: {
      provider,
      status: 'REVOKED',
      revokedAt: new Date().toISOString(),
    },
  });
});

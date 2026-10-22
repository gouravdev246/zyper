import { Router, Request, Response } from 'express';
import { gmailService } from '../services/gmail.service.js';

export const connectionsRouter = Router();

// GET /api/v1/connections - list integrations with live provider statuses
connectionsRouter.get('/connections', async (_req: Request, res: Response) => {
  const gmailStatus = await gmailService.getConnectionStatus();

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
        status: 'DISCONNECTED',
        scopes: ['calendar.readonly', 'calendar.events'],
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
        provider: 'windows_companion',
        name: 'Windows Local Companion',
        status: 'DISCONNECTED',
        scopes: ['desktop:app:launch', 'desktop:fs:search', 'desktop:media:control'],
        description: 'Native desktop companion: application launching, folder search, and media control.',
      },
    ],
  });
});

// GET /api/v1/connections/gmail/auth-url - generate OAuth2 authorization URL
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

// POST /api/v1/connections/gmail/callback - exchange auth code for tokens
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
            <h2 style="color:#4ade80;">Gmail Connected Successfully</h2>
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

// POST /api/v1/connections/gmail/disconnect - revoke Gmail credentials
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

// POST /api/v1/connections/gmail/mock-toggle - helper for dev / test simulation
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

// DELETE /api/v1/connections/:provider - generic revoke endpoint
connectionsRouter.delete('/connections/:provider', async (req: Request, res: Response) => {
  const { provider } = req.params;
  if (provider === 'gmail') {
    await gmailService.disconnect();
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

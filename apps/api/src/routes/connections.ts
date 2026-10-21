import { Router, Request, Response } from 'express';

export const connectionsRouter = Router();

// GET /api/v1/connections - list integrations
connectionsRouter.get('/connections', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: [
      {
        provider: 'gmail',
        name: 'Gmail',
        status: 'DISCONNECTED',
        description: 'Read unread emails, summarize, and draft replies',
      },
      {
        provider: 'google_calendar',
        name: 'Google Calendar',
        status: 'DISCONNECTED',
        description: 'Schedule briefings and event management',
      },
      {
        provider: 'x',
        name: 'X (Twitter)',
        status: 'DISCONNECTED',
        description: 'Topic research and approved post publishing',
      },
      {
        provider: 'windows_companion',
        name: 'Windows Local Companion',
        status: 'DISCONNECTED',
        description: 'Local app launching, approved folder search, and media control',
      },
    ],
  });
});

// POST /api/v1/connections/:provider/connect - initiate connection
connectionsRouter.post('/connections/:provider/connect', async (req: Request, res: Response) => {
  const { provider } = req.params;
  res.json({
    success: true,
    data: {
      provider,
      status: 'INITIATED',
      authUrl: `https://auth.zyper.local/connect/${provider}`,
    },
  });
});

// DELETE /api/v1/connections/:id - revoke connection
connectionsRouter.delete('/connections/:id', async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      id: req.params.id,
      status: 'REVOKED',
      revokedAt: new Date().toISOString(),
    },
  });
});

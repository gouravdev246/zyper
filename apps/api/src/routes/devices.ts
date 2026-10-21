import { Router, Request, Response } from 'express';
import { z } from 'zod';

export const devicesRouter = Router();

const pairDeviceSchema = z.object({
  deviceName: z.string().min(1, 'Device name is required'),
});

// GET /api/v1/devices - list paired devices
devicesRouter.get('/devices', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: [],
  });
});

// POST /api/v1/devices/pair - initiate device pairing
devicesRouter.post('/devices/pair', async (req: Request, res: Response) => {
  const parseResult = pairDeviceSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid device parameters',
        details: parseResult.error.format(),
      },
    });
    return;
  }

  const { deviceName } = parseResult.data;
  // Generate random 6-character pairing code
  const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  res.status(201).json({
    success: true,
    data: {
      id: crypto.randomUUID(),
      deviceName,
      pairingCode,
      status: 'PENDING_CONFIRMATION',
      expiresInSeconds: 300,
    },
  });
});

// DELETE /api/v1/devices/:id - revoke device
devicesRouter.delete('/devices/:id', async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      id: req.params.id,
      status: 'REVOKED',
      revokedAt: new Date().toISOString(),
    },
  });
});

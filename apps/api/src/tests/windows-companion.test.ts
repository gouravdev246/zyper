import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { windowsCompanionService } from '../services/windows-companion.service.js';

describe('Windows Local Companion API & Tools', () => {
  const app = createApp();

  beforeEach(() => {
    windowsCompanionService.setMockConnected(true);
  });

  describe('Companion Connection & Device Pairing', () => {
    it('GET /api/v1/connections/windows_companion/status should return device pairing status', async () => {
      const res = await request(app).get('/api/v1/connections/windows_companion/status');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('connected');
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data).toHaveProperty('approvedFolders');
      expect(res.body.data).toHaveProperty('whitelistedApps');
      expect(res.body.data.approvedFolders).toContain('workspace');
      expect(res.body.data.whitelistedApps).toContain('notepad');
    });

    it('POST /api/v1/connections/windows_companion/pair should pair host device', async () => {
      const res = await request(app)
        .post('/api/v1/connections/windows_companion/pair')
        .send({ deviceName: 'Test-Windows-Workstation' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('PAIRED');
      expect(res.body.data.deviceName).toBe('Test-Windows-Workstation');
    });

    it('POST /api/v1/connections/windows_companion/revoke should revoke device and disable commands', async () => {
      const revokeRes = await request(app).post('/api/v1/connections/windows_companion/revoke');
      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.success).toBe(true);
      expect(revokeRes.body.data.status).toBe('REVOKED');

      // Attempting to launch an app while revoked must fail
      const execRes = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'app.open',
          input: { appId: 'notepad' },
        });

      expect(execRes.body.data.status).toBe('FAILED');
      expect(execRes.body.data.error).toContain('revoked');
    });
  });

  describe('Application Launch Tool (app.open & desktop.app_launch)', () => {
    it('should launch permitted applications from the whitelist', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'app.open',
          input: { appId: 'calculator' },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUCCESS');
      expect(res.body.data.output).toHaveProperty('appId', 'calculator');
      expect(res.body.data.output).toHaveProperty('status', 'LAUNCHED');
      expect(res.body.data.output).toHaveProperty('launchedAt');
    });

    it('should support desktop.app_launch alias', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'desktop.app_launch',
          input: { appId: 'notepad' },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUCCESS');
      expect(res.body.data.output.appId).toBe('notepad');
    });

    it('should strictly reject applications not on the whitelist', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'app.open',
          input: { appId: 'malicious_script.bat' },
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.data.status).toBe('REJECTED');
      expect(res.body.data.error).toContain('Invalid input schema');
    });
  });

  describe('Media Control Tool (media.control & desktop.media_control)', () => {
    it('should execute supported media actions', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'media.control',
          input: { action: 'mute' },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUCCESS');
      expect(res.body.data.output).toHaveProperty('action', 'mute');
      expect(res.body.data.output).toHaveProperty('status', 'EXECUTED');
      expect(res.body.data.output).toHaveProperty('executedAt');
    });

    it('should support desktop.media_control alias', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'desktop.media_control',
          input: { action: 'play_pause' },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUCCESS');
      expect(res.body.data.output.action).toBe('play_pause');
    });

    it('should reject invalid media operations', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'media.control',
          input: { action: 'destroy_audio' },
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.data.status).toBe('REJECTED');
    });
  });

  describe('Approved Local Folder Search (files.search & desktop.fs_search)', () => {
    it('should search for files in approved workspace folder', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'files.search',
          input: {
            folderId: 'workspace',
            query: 'package.json',
            maxResults: 5,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUCCESS');
      expect(res.body.data.output).toHaveProperty('folderId', 'workspace');
      expect(res.body.data.output).toHaveProperty('results');
      expect(Array.isArray(res.body.data.output.results)).toBe(true);
      expect(res.body.data.output.totalFound).toBeGreaterThan(0);

      const found = res.body.data.output.results.find((r: any) => r.name === 'package.json');
      expect(found).toBeDefined();
      expect(found.isDirectory).toBe(false);
    });

    it('should support desktop.fs_search alias', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'desktop.fs_search',
          input: {
            folderId: 'workspace',
            query: 'PRD.md',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.output.totalFound).toBeGreaterThan(0);
    });

    it('should strictly block directory traversal attempts in query', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'files.search',
          input: {
            folderId: 'workspace',
            query: '../../Windows/System32',
          },
        });

      expect(res.body.data.status).toBe('FAILED');
      expect(res.body.data.error).toContain('Directory traversal attempt blocked');
    });

    it('should reject unapproved folder identifiers', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'files.search',
          input: {
            folderId: 'root_c_drive',
            query: 'bootmgr',
          },
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.data.status).toBe('REJECTED');
    });
  });
});

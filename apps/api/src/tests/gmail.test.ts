import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import { gmailService } from '../services/gmail.service.js';

describe('Gmail Integration & Credential Security', () => {
  const app = createApp();

  beforeEach(() => {
    gmailService.setMockConnected(true);
  });

  describe('1. AES-256-GCM Credential Encryption', () => {
    it('should encrypt and decrypt tokens symmetrically without loss', () => {
      const sensitiveToken = 'ya29.a0AfH6SMD_test_google_oauth_token_secret_12345';
      const encrypted = encrypt(sensitiveToken);

      expect(encrypted).not.toBe(sensitiveToken);
      expect(typeof encrypted).toBe('string');
      expect(encrypted.length).toBeGreaterThan(sensitiveToken.length);

      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(sensitiveToken);
    });

    it('should generate unique ciphertexts for identical inputs due to random IV', () => {
      const plaintext = 'identical_token_secret';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
      expect(decrypt(encrypted1)).toBe(plaintext);
      expect(decrypt(encrypted2)).toBe(plaintext);
    });

    it('should reject tampered or corrupted encrypted payloads', () => {
      const encrypted = encrypt('valid_payload');
      const tampered = encrypted.slice(0, -4) + 'AAAA';

      expect(() => decrypt(tampered)).toThrow();
    });
  });

  describe('2. Gmail OAuth2 Connections Endpoints', () => {
    it('GET /api/v1/connections/gmail/auth-url should generate valid Google OAuth URL', async () => {
      const res = await request(app).get('/api/v1/connections/gmail/auth-url');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.provider).toBe('gmail');

      const { authUrl } = res.body.data;
      expect(authUrl).toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(authUrl).toContain('scope=');
      expect(authUrl).toContain('gmail.readonly');
      expect(authUrl).toContain('gmail.compose');
      expect(authUrl).toContain('gmail.send');
    });

    it('GET /api/v1/connections should list Gmail with live connection details', async () => {
      const res = await request(app).get('/api/v1/connections');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const gmail = res.body.data.find((c: any) => c.provider === 'gmail');
      expect(gmail).toBeDefined();
      expect(gmail.name).toBe('Gmail');
      expect(gmail.status).toBe('CONNECTED');
      expect(gmail.scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
    });

    it('POST /api/v1/connections/gmail/callback should handle code exchange', async () => {
      const res = await request(app)
        .post('/api/v1/connections/gmail/callback')
        .send({ code: 'auth_code_test_abc123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.provider).toBe('gmail');
    });

    it('POST /api/v1/connections/gmail/callback should reject missing code', async () => {
      const res = await request(app)
        .post('/api/v1/connections/gmail/callback')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('POST /api/v1/connections/gmail/disconnect should revoke connection', async () => {
      const res = await request(app).post('/api/v1/connections/gmail/disconnect');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('DISCONNECTED');

      const checkRes = await request(app).get('/api/v1/connections');
      const gmail = checkRes.body.data.find((c: any) => c.provider === 'gmail');
      expect(gmail.status).toBe('DISCONNECTED');
    });
  });

  describe('3. Gmail Tools Execution via Tool Registry', () => {
    it('POST /api/v1/tools/execute for gmail.list_unread should return unread messages', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'gmail.list_unread',
          input: { maxResults: 5 },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUCCESS');
      expect(res.body.data.output.messages.length).toBeGreaterThan(0);
      expect(res.body.data.output.messages[0]).toHaveProperty('subject');
      expect(res.body.data.output.messages[0]).toHaveProperty('from');
      expect(res.body.data.output.messages[0]).toHaveProperty('snippet');
    });

    it('POST /api/v1/tools/execute for gmail.read_message should return full email detail', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'gmail.read_message',
          input: { messageId: 'gm-msg-101' },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUCCESS');
      expect(res.body.data.output.message.id).toBe('gm-msg-101');
      expect(res.body.data.output.message).toHaveProperty('body');
    });

    it('POST /api/v1/tools/execute for gmail.create_draft should create draft without approval', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'gmail.create_draft',
          input: {
            to: 'sarah.product@enterprise.io',
            subject: 'Re: Q4 Product Roadmap & Sprint Prioritization',
            body: 'I reviewed the roadmap and the items look solid. Ready for the sync.',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUCCESS');
      expect(res.body.data.output.status).toBe('DRAFT_CREATED');
      expect(res.body.data.output).toHaveProperty('draftId');
    });

    it('POST /api/v1/tools/execute for gmail.send should strictly require human approval', async () => {
      const emailInput = {
        to: 'client@company.org',
        subject: 'Weekly Status Report',
        body: 'Here is your weekly delivery status report for review.',
      };

      // 1. Initial attempt is paused
      const res1 = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'gmail.send',
          input: emailInput,
        });

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(false);
      expect(res1.body.data.status).toBe('REQUIRES_APPROVAL');
      const approval = res1.body.data.approval;
      expect(approval.toolId).toBe('gmail.send');

      // 2. Approve action
      await request(app)
        .post(`/api/v1/approvals/${approval.id}/decision`)
        .send({ decision: 'APPROVED' });

      // 3. Authorized execution succeeds
      const res2 = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'gmail.send',
          input: emailInput,
          approvalId: approval.id,
        });

      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
      expect(res2.body.data.status).toBe('SUCCESS');
      expect(res2.body.data.output.status).toBe('SENT');
      expect(res2.body.data.output).toHaveProperty('messageId');
    });

    it('should fail with helpful message if tool executed while Gmail is disconnected', async () => {
      gmailService.setMockConnected(false);

      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'gmail.list_unread',
          input: { maxResults: 5 },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.data.status).toBe('FAILED');
      expect(res.body.data.error).toContain('Gmail integration is not connected');
    });
  });
});

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

describe('Tool Registry & Policy Engine API', () => {
  const app = createApp();

  it('GET /api/v1/tools should list registered safe tools with contracts', async () => {
    const res = await request(app).get('/api/v1/tools');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const toolIds = res.body.data.map((t: any) => t.id);
    expect(toolIds).toContain('web.search');
    expect(toolIds).toContain('calendar.list_events');
    expect(toolIds).toContain('gmail.list_unread');
    expect(toolIds).toContain('gmail.create_draft');
    expect(toolIds).toContain('gmail.send');
    expect(toolIds).toContain('app.open');
  });

  it('POST /api/v1/tools/execute should strictly REJECT unregistered tools', async () => {
    const res = await request(app)
      .post('/api/v1/tools/execute')
      .send({
        toolId: 'unregistered.dangerous_tool',
        input: { cmd: 'rm -rf /' },
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.data.status).toBe('REJECTED');
    expect(res.body.data.error).toContain('Unknown tool');
  });

  it('POST /api/v1/tools/execute should automatically execute READ_ONLY tools', async () => {
    const res = await request(app)
      .post('/api/v1/tools/execute')
      .send({
        toolId: 'web.search',
        input: { query: 'LangGraph human in the loop workflows' },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('SUCCESS');
    expect(res.body.data.output).toHaveProperty('results');
    expect(res.body.data.output.results.length).toBeGreaterThan(0);
  });

  it('POST /api/v1/tools/execute should require explicit approval for CONSEQUENTIAL tools', async () => {
    const emailPayload = {
      to: 'team@zyper.local',
      subject: 'Critical Infrastructure Update',
      body: 'Deploying release v0.1.0 to production cluster.',
    };

    // 1. First execution attempt -> Blocked, requires approval
    const attempt1 = await request(app)
      .post('/api/v1/tools/execute')
      .send({
        toolId: 'gmail.send',
        input: emailPayload,
      });

    expect(attempt1.status).toBe(200);
    expect(attempt1.body.success).toBe(false);
    expect(attempt1.body.data.status).toBe('REQUIRES_APPROVAL');
    expect(attempt1.body.data).toHaveProperty('approval');

    const approval = attempt1.body.data.approval;
    expect(approval.status).toBe('PENDING');
    expect(approval.toolId).toBe('gmail.send');

    // 2. User approves the action
    const decisionRes = await request(app)
      .post(`/api/v1/approvals/${approval.id}/decision`)
      .send({ decision: 'APPROVED' });

    expect(decisionRes.status).toBe(200);
    expect(decisionRes.body.data.status).toBe('APPROVED');

    // 3. Re-execute with approvalId -> Authorized and executed
    const attempt2 = await request(app)
      .post('/api/v1/tools/execute')
      .send({
        toolId: 'gmail.send',
        input: emailPayload,
        approvalId: approval.id,
      });

    expect(attempt2.status).toBe(200);
    expect(attempt2.body.success).toBe(true);
    expect(attempt2.body.data.status).toBe('SUCCESS');
    expect(attempt2.body.data.output.status).toBe('SENT');
  });

  it('POST /api/v1/tools/execute should invalidate approval if action payload is tampered with', async () => {
    // 1. Request approval for action
    const originalPayload = {
      to: 'recipient@safe.com',
      subject: 'Quarterly Bonus',
      body: 'Review your quarterly performance bonus.',
    };

    const attempt = await request(app)
      .post('/api/v1/tools/execute')
      .send({
        toolId: 'gmail.send',
        input: originalPayload,
      });

    const approvalId = attempt.body.data.approval.id;

    // 2. Approve original
    await request(app)
      .post(`/api/v1/approvals/${approvalId}/decision`)
      .send({ decision: 'APPROVED' });

    // 3. Attempt execution with altered recipient
    const tamperedAttempt = await request(app)
      .post('/api/v1/tools/execute')
      .send({
        toolId: 'gmail.send',
        input: {
          to: 'attacker@malicious.com', // Tampered!
          subject: 'Quarterly Bonus',
          body: 'Review your quarterly performance bonus.',
        },
        approvalId,
      });

    expect(tamperedAttempt.body.success).toBe(false);
    expect(tamperedAttempt.body.data.status).toBe('REQUIRES_APPROVAL');
    expect(tamperedAttempt.body.data.error).toContain('Action arguments do not match approved payload');
  });

  it('GET /api/v1/audit-events should record audit trail for security checks', async () => {
    const res = await request(app).get('/api/v1/audit-events');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

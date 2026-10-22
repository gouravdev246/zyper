import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { calendarService } from '../services/calendar.service.js';

describe('Google Calendar Integration & Safe Tool Adapters', () => {
  const app = createApp();

  beforeEach(() => {
    calendarService.setMockConnected(true);
  });

  describe('1. Google Calendar OAuth2 Connections Endpoints', () => {
    it('GET /api/v1/connections/google_calendar/auth-url should generate valid Google OAuth URL', async () => {
      const res = await request(app).get('/api/v1/connections/google_calendar/auth-url');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.provider).toBe('google_calendar');

      const { authUrl } = res.body.data;
      expect(authUrl).toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(authUrl).toContain('calendar.readonly');
      expect(authUrl).toContain('calendar.events');
    });

    it('GET /api/v1/connections should list Google Calendar with live connection status', async () => {
      const res = await request(app).get('/api/v1/connections');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const calendar = res.body.data.find((c: any) => c.provider === 'google_calendar');
      expect(calendar).toBeDefined();
      expect(calendar.name).toBe('Google Calendar');
      expect(calendar.status).toBe('CONNECTED');
      expect(calendar.scopes).toContain('https://www.googleapis.com/auth/calendar.readonly');
    });

    it('POST /api/v1/connections/google_calendar/callback should handle code exchange', async () => {
      const res = await request(app)
        .post('/api/v1/connections/google_calendar/callback')
        .send({ code: 'cal_auth_code_xyz789' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.provider).toBe('google_calendar');
    });

    it('POST /api/v1/connections/google_calendar/disconnect should revoke credentials', async () => {
      const res = await request(app).post('/api/v1/connections/google_calendar/disconnect');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('DISCONNECTED');

      const checkRes = await request(app).get('/api/v1/connections');
      const calendar = checkRes.body.data.find((c: any) => c.provider === 'google_calendar');
      expect(calendar.status).toBe('DISCONNECTED');
    });
  });

  describe('2. Calendar Tools Execution via Safe Tool Registry', () => {
    it('POST /api/v1/tools/execute for calendar.list_events should return scheduled events', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'calendar.list_events',
          input: { daysAhead: 7, maxResults: 5 },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUCCESS');
      expect(res.body.data.output.events.length).toBeGreaterThan(0);

      const firstEvt = res.body.data.output.events[0];
      expect(firstEvt).toHaveProperty('id');
      expect(firstEvt).toHaveProperty('summary');
      expect(firstEvt).toHaveProperty('start');
      expect(firstEvt).toHaveProperty('end');
    });

    it('POST /api/v1/tools/execute for calendar.check_conflicts should detect overlapping events', async () => {
      const now = new Date();
      const conflictStart = new Date(now);
      conflictStart.setHours(10, 30, 0, 0); // overlaps with 10:00 - 11:00 AM standup
      const conflictEnd = new Date(now);
      conflictEnd.setHours(11, 30, 0, 0);

      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'calendar.check_conflicts',
          input: {
            start: conflictStart.toISOString(),
            end: conflictEnd.toISOString(),
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.output.hasConflict).toBe(true);
      expect(res.body.data.output.conflictingEvents.length).toBeGreaterThan(0);
    });

    it('POST /api/v1/tools/execute for calendar.check_conflicts should report clean slot when no overlap', async () => {
      const now = new Date();
      const clearStart = new Date(now);
      clearStart.setHours(6, 0, 0, 0); // 6:00 - 7:00 AM is clear
      const clearEnd = new Date(now);
      clearEnd.setHours(7, 0, 0, 0);

      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'calendar.check_conflicts',
          input: {
            start: clearStart.toISOString(),
            end: clearEnd.toISOString(),
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.output.hasConflict).toBe(false);
      expect(res.body.data.output.conflictingEvents).toHaveLength(0);
    });

    it('POST /api/v1/tools/execute for calendar.create_event should strictly require human approval', async () => {
      const now = new Date();
      const start = new Date(now.getTime() + 48 * 3600 * 1000).toISOString();
      const end = new Date(now.getTime() + 49 * 3600 * 1000).toISOString();

      const eventPayload = {
        summary: 'Executive Milestone Demo & AI Safety Review',
        start,
        end,
        description: 'Demonstration of deterministic policy engine and Google Workspace integrations.',
        location: 'Boardroom A / Google Meet',
        attendees: ['lead@zyper.local'],
      };

      // 1. Initial attempt is paused by Policy Engine
      const res1 = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'calendar.create_event',
          input: eventPayload,
        });

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(false);
      expect(res1.body.data.status).toBe('REQUIRES_APPROVAL');
      const approval = res1.body.data.approval;
      expect(approval.toolId).toBe('calendar.create_event');

      // 2. User approves the event booking (now immediately executes the authorized action)
      const decisionRes = await request(app)
        .post(`/api/v1/approvals/${approval.id}/decision`)
        .send({ decision: 'APPROVED' });

      expect(decisionRes.status).toBe(200);
      expect(decisionRes.body.data.status).toBe('APPROVED');
      expect(decisionRes.body.data.execution).toBeDefined();
      expect(decisionRes.body.data.execution.status).toBe('SUCCESS');
      expect(decisionRes.body.data.execution.output.summary).toBe(eventPayload.summary);

      // 3. Authorized execution succeeds
      const res2 = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'calendar.create_event',
          input: eventPayload,
          approvalId: approval.id,
        });

      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
      expect(res2.body.data.status).toBe('SUCCESS');
      expect(res2.body.data.output.summary).toBe(eventPayload.summary);
      expect(res2.body.data.output).toHaveProperty('id');
    });

    it('should fail with clear error if calendar tool executed while disconnected', async () => {
      calendarService.setMockConnected(false);

      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'calendar.list_events',
          input: { daysAhead: 7 },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.data.status).toBe('FAILED');
      expect(res.body.data.error).toContain('Google Calendar integration is not connected');
    });
  });
});

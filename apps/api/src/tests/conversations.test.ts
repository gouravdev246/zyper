import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

describe('Conversations API', () => {
  const app = createApp();

  it('POST /api/v1/conversations should create a new conversation', async () => {
    const res = await request(app)
      .post('/api/v1/conversations')
      .send({ title: 'Inbox Management' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.title).toBe('Inbox Management');
  });

  it('GET /api/v1/conversations should return list of conversations', async () => {
    const res = await request(app).get('/api/v1/conversations');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /api/v1/conversations/:id/messages should stream assistant response', async () => {
    // 1. Create a conversation
    const createConvo = await request(app)
      .post('/api/v1/conversations')
      .send({ title: 'Task Planning Test' });
    const convoId = createConvo.body.data.id;

    // 2. Post a message with streaming
    const res = await request(app)
      .post(`/api/v1/conversations/${convoId}/messages`)
      .send({ content: 'Summarize today\'s priority emails' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('run.created');
    expect(res.text).toContain('token');
    expect(res.text).toContain('run.completed');

    // 3. Verify message history persisted
    const historyRes = await request(app).get(`/api/v1/conversations/${convoId}/messages`);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.data.length).toBeGreaterThanOrEqual(2); // user message + assistant message
    expect(historyRes.body.data[0].role).toBe('user');
    expect(historyRes.body.data[1].role).toBe('assistant');
  });
});

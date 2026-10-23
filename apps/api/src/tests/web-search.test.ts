import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { webSearchService } from '../services/web-search.service.js';

describe('Web Search & Browser Automation Tools', () => {
  const app = createApp();

  describe('WebSearchService Unit Tests', () => {
    it('should perform live web search and return real structured results', async () => {
      const output = await webSearchService.search('nodejs runtime', 3);
      expect(output).toHaveProperty('query', 'nodejs runtime');
      expect(output.totalFound).toBeGreaterThan(0);
      expect(Array.isArray(output.results)).toBe(true);

      const first = output.results[0];
      expect(first).toHaveProperty('title');
      expect(first).toHaveProperty('url');
      expect(first).toHaveProperty('snippet');
      expect(first.url.startsWith('http')).toBe(true);
      expect(first.title.length).toBeGreaterThan(0);
    }, 15000);

    it('should return empty results for empty query', async () => {
      const output = await webSearchService.search('   ');
      expect(output.totalFound).toBe(0);
      expect(output.results).toEqual([]);
    });

    it('should resolve a song query to a direct YouTube video', async () => {
      const yt = await webSearchService.resolveYouTubeVideo('believer imagine dragons');
      expect(yt).toHaveProperty('query', 'believer imagine dragons');
      expect(yt).toHaveProperty('watchUrl');
      expect(yt.watchUrl).toContain('youtube.com');
      if (yt.videoId) {
        expect(yt.videoId).toHaveLength(11);
        expect(yt.watchUrl).toBe(`https://www.youtube.com/watch?v=${yt.videoId}`);
      }
    }, 15000);

    it('should strictly reject unsafe URL protocols in openUrlInBrowser', async () => {
      await expect(webSearchService.openUrlInBrowser('javascript:alert(1)')).rejects.toThrow(
        'Invalid URL protocol'
      );
      await expect(webSearchService.openUrlInBrowser('file:///C:/Windows/System32')).rejects.toThrow(
        'Invalid URL protocol'
      );
    });

    it('should successfully open valid HTTP/HTTPS URLs', async () => {
      const result = await webSearchService.openUrlInBrowser('https://github.com');
      expect(result.success).toBe(true);
      expect(result.status).toBe('OPENED');
      expect(result.url).toBe('https://github.com');
      expect(result).toHaveProperty('openedAt');
    });

    it('should resolve and play YouTube music query', async () => {
      const result = await webSearchService.playYouTube('lofi hip hop');
      expect(result.success).toBe(true);
      expect(result.status).toBe('PLAYING');
      expect(result.watchUrl).toContain('youtube.com');
    }, 15000);
  });

  describe('Tool Registry Execution via API', () => {
    it('POST /api/v1/tools/execute should execute web.search and return live results', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'web.search',
          input: {
            query: 'expressjs framework',
            maxResults: 3,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUCCESS');
      expect(res.body.data.output).toHaveProperty('results');
      expect(res.body.data.output.results.length).toBeGreaterThan(0);
    }, 15000);

    it('POST /api/v1/tools/execute should execute browser.open_url', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'browser.open_url',
          input: {
            url: 'https://en.wikipedia.org',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUCCESS');
      expect(res.body.data.output.status).toBe('OPENED');
    });

    it('POST /api/v1/tools/execute should support web.open_url alias', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'web.open_url',
          input: {
            url: 'https://www.google.com',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUCCESS');
    });

    it('POST /api/v1/tools/execute should execute browser.play_youtube for songs', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'browser.play_youtube',
          input: {
            query: 'shape of you ed sheeran',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUCCESS');
      expect(res.body.data.output.status).toBe('PLAYING');
      expect(res.body.data.output.watchUrl).toContain('youtube.com');
    }, 15000);

    it('POST /api/v1/tools/execute should support youtube.play alias', async () => {
      const res = await request(app)
        .post('/api/v1/tools/execute')
        .send({
          toolId: 'youtube.play',
          input: {
            query: 'viva la vida coldplay',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUCCESS');
      expect(res.body.data.output.status).toBe('PLAYING');
    }, 15000);
  });
});

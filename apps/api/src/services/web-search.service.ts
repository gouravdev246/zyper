import { exec, spawn } from 'child_process';
import { logger } from '../lib/logger.js';

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutput {
  query: string;
  totalFound: number;
  results: WebSearchResultItem[];
}

export interface YouTubeResolveResult {
  query: string;
  videoId?: string;
  videoTitle?: string;
  watchUrl: string;
  searchUrl: string;
}

export class WebSearchService {
  /**
   * Performs live DuckDuckGo web search without requiring any third-party API keys.
   * Returns clean titles, direct URLs, and text snippets.
   */
  async search(query: string, maxResults: number = 8): Promise<WebSearchOutput> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return { query: '', totalFound: 0, results: [] };
    }

    try {
      const res = await fetch('https://html.duckduckgo.com/html/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        body: `q=${encodeURIComponent(trimmedQuery)}`,
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        throw new Error(`DuckDuckGo returned HTTP status ${res.status}`);
      }

      const html = await res.text();
      const results = this.parseDuckDuckGoHtml(html, maxResults);

      if (results.length > 0) {
        return {
          query: trimmedQuery,
          totalFound: results.length,
          results,
        };
      }
    } catch (err) {
      logger.warn(`Direct DuckDuckGo HTML search failed or timed out: ${err}. Attempting API fallback.`);
    }

    // Fallback: DuckDuckGo Instant Answer API or synthesized clean search URL
    try {
      const apiRes = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(trimmedQuery)}&format=json&no_html=1&skip_disambig=1`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (apiRes.ok) {
        const data = (await apiRes.json()) as any;
        const apiResults: WebSearchResultItem[] = [];

        if (data.AbstractText && data.AbstractURL) {
          apiResults.push({
            title: data.Heading || trimmedQuery,
            url: data.AbstractURL,
            snippet: data.AbstractText,
          });
        }

        if (Array.isArray(data.RelatedTopics)) {
          for (const topic of data.RelatedTopics) {
            if (topic.Text && topic.FirstURL) {
              apiResults.push({
                title: topic.Text.split(' - ')[0] || trimmedQuery,
                url: topic.FirstURL,
                snippet: topic.Text,
              });
              if (apiResults.length >= maxResults) break;
            }
          }
        }

        if (apiResults.length > 0) {
          return {
            query: trimmedQuery,
            totalFound: apiResults.length,
            results: apiResults,
          };
        }
      }
    } catch (apiErr) {
      logger.warn(`DuckDuckGo Instant Answer API fallback also failed: ${apiErr}`);
    }

    // Last resort graceful return with direct search URL
    return {
      query: trimmedQuery,
      totalFound: 1,
      results: [
        {
          title: `Search Web for "${trimmedQuery}"`,
          url: `https://duckduckgo.com/?q=${encodeURIComponent(trimmedQuery)}`,
          snippet: `Live search query results for: ${trimmedQuery}`,
        },
      ],
    };
  }

  /**
   * Parses DuckDuckGo HTML response into structured search items.
   */
  private parseDuckDuckGoHtml(html: string, maxResults: number): WebSearchResultItem[] {
    const blocks = html.split(/class="[^"]*web-result[^"]*"/);
    const results: WebSearchResultItem[] = [];

    for (let i = 1; i < blocks.length; i++) {
      if (results.length >= maxResults) break;
      const block = blocks[i];

      const titleMatch = block.match(
        /<a\s+[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
      );
      const snippetMatch = block.match(
        /<a\s+[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i
      );

      if (titleMatch) {
        const rawUrl = titleMatch[1];
        let cleanUrl = rawUrl;

        // Unpack DuckDuckGo redirect url: /l/?uddg=https%3A%2F%2F...
        const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          try {
            cleanUrl = decodeURIComponent(uddgMatch[1]);
          } catch {
            cleanUrl = rawUrl;
          }
        } else if (rawUrl.startsWith('//')) {
          cleanUrl = 'https:' + rawUrl;
        }

        const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();
        const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

        if (title && cleanUrl && cleanUrl.startsWith('http')) {
          results.push({
            title,
            url: cleanUrl,
            snippet,
          });
        }
      }
    }

    return results;
  }

  /**
   * Resolves a video or song query into a direct YouTube watch URL.
   */
  async resolveYouTubeVideo(query: string): Promise<YouTubeResolveResult> {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    try {
      const res = await fetch(searchUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const html = await res.text();
        const videoMatch = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);

        if (videoMatch && videoMatch[1]) {
          const videoId = videoMatch[1];
          const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

          // Try to extract video title
          let videoTitle = query;
          const titleRegex = /"title":{"runs":\[{"text":"([^"]+)"/i;
          const titleMatch = html.match(titleRegex);
          if (titleMatch && titleMatch[1]) {
            videoTitle = titleMatch[1];
          }

          return {
            query,
            videoId,
            videoTitle,
            watchUrl,
            searchUrl,
          };
        }
      }
    } catch (err) {
      logger.warn(`Failed to resolve direct YouTube video for "${query}": ${err}`);
    }

    // Fallback to YouTube search URL if exact video ID couldn't be parsed
    return {
      query,
      watchUrl: searchUrl,
      searchUrl,
    };
  }

  /**
   * Opens any valid web URL safely in the user's default desktop browser.
   */
  async openUrlInBrowser(url: string): Promise<{
    success: boolean;
    url: string;
    status: string;
    openedAt: string;
  }> {
    const trimmed = url.trim();

    // Security validation: only allow http and https protocols
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      throw new Error(`Invalid URL protocol. Only http:// and https:// web addresses can be opened.`);
    }

    const openedAt = new Date().toISOString();

    // In unit test environment, return simulated success without popping windows
    if (process.env.NODE_ENV === 'test') {
      return {
        success: true,
        url: trimmed,
        status: 'OPENED',
        openedAt,
      };
    }

    // Windows browser launcher
    if (process.platform === 'win32') {
      try {
        // Use PowerShell Start-Process with sanitized URL
        const ps = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', `Start-Process "${trimmed.replace(/"/g, '`"')}"`],
          { stdio: 'ignore', detached: true }
        );
        ps.unref();

        return {
          success: true,
          url: trimmed,
          status: 'OPENED',
          openedAt,
        };
      } catch {
        // Fallback to cmd start
        exec(`start "" "${trimmed}"`);
        return {
          success: true,
          url: trimmed,
          status: 'OPENED',
          openedAt,
        };
      }
    } else if (process.platform === 'darwin') {
      exec(`open "${trimmed}"`);
    } else {
      exec(`xdg-open "${trimmed}"`);
    }

    return {
      success: true,
      url: trimmed,
      status: 'OPENED',
      openedAt,
    };
  }

  /**
   * Resolves the requested song/video and opens it directly in YouTube for instant playback.
   */
  async playYouTube(query: string): Promise<{
    success: boolean;
    query: string;
    videoTitle?: string;
    videoId?: string;
    watchUrl: string;
    status: string;
    openedAt: string;
  }> {
    const resolved = await this.resolveYouTubeVideo(query);
    const opened = await this.openUrlInBrowser(resolved.watchUrl);

    return {
      success: true,
      query,
      videoTitle: resolved.videoTitle,
      videoId: resolved.videoId,
      watchUrl: resolved.watchUrl,
      status: 'PLAYING',
      openedAt: opened.openedAt,
    };
  }
}

export const webSearchService = new WebSearchService();

/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import {Strategy} from 'serwist';
import type {SerwistPlugin, StrategyHandler} from 'serwist';

const CACHE_TIME_HEADER = 'x-cache-time';

// Injects a cache timestamp into the response headers before storing.
// Used by CacheFirstWithSWR to determine entry age without ExpirationPlugin.
const cacheTimePlugin: SerwistPlugin = {
  cacheWillUpdate: async ({response}) => {
    const cloned = response.clone();
    const headers = new Headers(cloned.headers);
    headers.set(CACHE_TIME_HEADER, Date.now().toString());
    return new Response(cloned.body, {
      status: cloned.status,
      statusText: cloned.statusText,
      headers,
    });
  },
};

interface CacheFirstWithSWROptions {
  cacheName: string;
  // How long a cached response is considered fresh (no network hit at all).
  // After this window, the stale response is returned immediately and the
  // cache is updated in the background (stale-while-revalidate).
  maxAgeSeconds: number;
}

/**
 * A hybrid caching strategy:
 *
 * - Within maxAgeSeconds: serve from cache only (zero network).
 * - After maxAgeSeconds: serve stale from cache, revalidate in background.
 * - No cache: fetch from network, cache the result.
 *
 * This gives CacheFirst performance within the freshness window and
 * StaleWhileRevalidate behaviour once the window expires — the page
 * is never blocked waiting for the network after the first visit.
 */
export class CacheFirstWithSWR extends Strategy {
  private readonly maxAgeMs: number;

  constructor(options: CacheFirstWithSWROptions) {
    super({
      cacheName: options.cacheName,
      plugins: [cacheTimePlugin],
    });
    this.maxAgeMs = options.maxAgeSeconds * 1000;
  }

  async _handle(request: Request, handler: StrategyHandler): Promise<Response> {
    const cached = await handler.cacheMatch(request);

    if (cached) {
      const cachedAt = Number(cached.headers.get(CACHE_TIME_HEADER) ?? 0);
      const age = Number.isFinite(cachedAt) ? Date.now() - cachedAt : Infinity;

      if (age < this.maxAgeMs) {
        // Fresh — cache only, no network at all
        return cached;
      }

      // Stale — return immediately, revalidate in background
      void handler.waitUntil(handler.fetchAndCachePut(request).catch(() => {}));
      return cached;
    }

    // Cold cache — block on network once, then all subsequent requests are fast
    return handler.fetchAndCachePut(request);
  }
}

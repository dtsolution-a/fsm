import type { NextFunction, Request, Response } from 'express';

/**
 * A light per-address ceiling on every API call (on top of the stricter limits on login and the public pages).
 * Counts live in memory: enough for one server, and it stops scripts hammering the API.
 */
export function apiRateLimit(limit = Number(process.env.API_RATE_LIMIT) || 600, windowMs = 60_000) {
  const hits = new Map<string, { n: number; reset: number }>();
  const sweep = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs);
  sweep.unref();
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path.endsWith('/health')) return next();
    const now = Date.now();
    const key = req.ip || 'unknown';
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    if (++h.n > limit) {
      res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000));
      return res.status(429).json({ statusCode: 429, message: 'Too many requests. Please slow down.' });
    }
    next();
  };
}

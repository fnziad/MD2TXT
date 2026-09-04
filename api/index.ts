import type { Request, Response } from 'express';

// Lazy loading keeps Vercel's function bootstrap from failing silently and
// lets us return a useful JSON error if a runtime dependency is unavailable.
export default async function handler(req: Request, res: Response) {
  try {
    const { default: app } = await import('../server/index');
    return app(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export service failed to initialize.';
    return res.status(500).json({ message });
  }
}

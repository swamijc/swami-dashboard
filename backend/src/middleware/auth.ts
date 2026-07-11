import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if ((req.session as any).userId) {
    next();
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if ((req.session as any).role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
}

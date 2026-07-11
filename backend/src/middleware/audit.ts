import { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/database';

export function auditLog(action: string, entityType?: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO audit_logs (user_id, action, entity_type, ip_address)
        VALUES (?, ?, ?, ?)
      `).run((req.session as any).userId ?? null, action, entityType ?? null, req.ip ?? null);
    } catch (_) { /* non-blocking */ }
    next();
  };
}

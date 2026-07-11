import { Store } from 'express-session';
import { DatabaseSync } from 'node:sqlite';

export class SQLiteSessionStore extends Store {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    super();
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS http_sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expired INTEGER NOT NULL
      );
    `);
    // Clean expired sessions every 15 minutes
    setInterval(() => this.clearExpired(), 15 * 60 * 1000);
  }

  get(sid: string, cb: (err: any, session?: any) => void): void {
    try {
      const row = this.db.prepare(`SELECT sess, expired FROM http_sessions WHERE sid = ?`).get(sid) as any;
      if (!row) return cb(null, null);
      if (Date.now() > row.expired) {
        this.destroy(sid, () => {});
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (err) { cb(err); }
  }

  set(sid: string, session: any, cb?: (err?: any) => void): void {
    try {
      const maxAge = (session.cookie?.maxAge || 8 * 60 * 60 * 1000);
      const expired = Date.now() + maxAge;
      this.db.prepare(`
        INSERT INTO http_sessions (sid, sess, expired) VALUES (?,?,?)
        ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expired=excluded.expired
      `).run(sid, JSON.stringify(session), expired);
      cb?.();
    } catch (err) { cb?.(err); }
  }

  destroy(sid: string, cb?: (err?: any) => void): void {
    try {
      this.db.prepare(`DELETE FROM http_sessions WHERE sid = ?`).run(sid);
      cb?.();
    } catch (err) { cb?.(err); }
  }

  private clearExpired(): void {
    try {
      this.db.prepare(`DELETE FROM http_sessions WHERE expired < ?`).run(Date.now());
    } catch (_) {}
  }
}

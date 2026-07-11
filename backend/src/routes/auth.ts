import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/database';
import { auditLog } from '../middleware/audit';

const router = Router();

router.post('/login', auditLog('login'), async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  const db = getDb();
  const user = db.prepare(`SELECT * FROM users WHERE username = ? AND is_active = 1`).get(username) as any;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  (req.session as any).userId = user.id;
  (req.session as any).username = user.username;
  (req.session as any).role = user.role;

  res.json({ id: user.id, username: user.username, email: user.email, role: user.role });
});

router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out' });
  });
});

router.get('/me', (req: Request, res: Response) => {
  const session = req.session as any;
  if (!session.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const db = getDb();
  const user = db.prepare(`SELECT id, username, email, role FROM users WHERE id = ?`).get(session.userId) as any;
  res.json(user ?? { error: 'User not found' });
});

export default router;

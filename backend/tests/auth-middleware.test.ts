import { describe, expect, it, vi } from 'vitest';
import { requireAdmin, requireAuth } from '../src/middleware/auth';

function mockResponse() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('auth middleware', () => {
  it('allows authenticated sessions', () => {
    const req: any = { session: { userId: 1 } };
    const res = mockResponse();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests', () => {
    const req: any = { session: {} };
    const res = mockResponse();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated' });
  });

  it('allows admin sessions', () => {
    const req: any = { session: { role: 'admin' } };
    const res = mockResponse();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects non-admin sessions', () => {
    const req: any = { session: { role: 'viewer' } };
    const res = mockResponse();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
  });
});
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  axiosPost: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    post: mocks.axiosPost,
  },
}));

let app: any;

beforeAll(async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swami-dashboard-test-'));
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = path.join(dbDir, 'dashboard.db');
  process.env.SESSION_SECRET = 'test-session-secret';
  process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
  process.env.ADMIN_PASSWORD = 'Admin@1234!';
  process.env[`JIRA_${'API_TOKEN_ID'}`] = 'test-token';
  const module = await import('../src/index');
  app = module.createApp();
});

describe('gateway regression and security routes', () => {
  it('returns backend health status', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('swami-dashboard-gateway');
  });

  it('rejects invalid logins', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Invalid credentials');
  });

  it('logs in admin and returns the current user', async () => {
    const agent = request.agent(app);

    const login = await agent
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'Admin@1234!' });

    expect(login.status).toBe(200);
    expect(login.body.role).toBe('admin');
    expect(login.headers['set-cookie']?.[0]).toContain('HttpOnly');

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('admin');
  });

  it('protects admin APIs from anonymous users', async () => {
    const response = await request(app).get('/api/admin/users');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Not authenticated');
  });

  it('allows authenticated admins to read users', async () => {
    const agent = request.agent(app);

    await agent.post('/api/auth/login').send({ username: 'admin', password: 'Admin@1234!' });
    const response = await agent.get('/api/admin/users');

    expect(response.status).toBe(200);
    expect(response.body.some((user: any) => user.username === 'admin')).toBe(true);
  });

  it('allows viewers to read Jira only with the default JQL', async () => {
    const adminAgent = request.agent(app);
    const viewerAgent = request.agent(app);
    mocks.axiosPost.mockResolvedValueOnce({ data: { issues: [] } });

    await adminAgent.post('/api/auth/login').send({ username: 'admin', password: 'Admin@1234!' });
    await adminAgent.post('/api/admin/users').send({
      username: 'jira-viewer',
      email: 'jira-viewer@dashboard.local',
      password: 'Viewer@1234!',
      role: 'viewer',
    });
    await viewerAgent.post('/api/auth/login').send({ username: 'jira-viewer', password: 'Viewer@1234!' });

    const response = await viewerAgent.post('/api/jira/report').send({ jql: 'project = SHOULD_NOT_RUN' });

    expect(response.status).toBe(200);
    expect(response.body.jql).toContain('Sprint in openSprints()');
    expect(response.body.jql).not.toContain('SHOULD_NOT_RUN');
    expect(mocks.axiosPost).toHaveBeenLastCalledWith(
      expect.stringContaining('/rest/api/3/search/jql'),
      expect.objectContaining({ jql: expect.stringContaining('Sprint in openSprints()') }),
      expect.any(Object)
    );
  });

  it('allows viewers to read release details but blocks release promotion', async () => {
    const adminAgent = request.agent(app);
    const viewerAgent = request.agent(app);

    await adminAgent.post('/api/auth/login').send({ username: 'admin', password: 'Admin@1234!' });
    await adminAgent.post('/api/admin/users').send({
      username: 'release-viewer',
      email: 'release-viewer@dashboard.local',
      password: 'Viewer@1234!',
      role: 'viewer',
    });
    await viewerAgent.post('/api/auth/login').send({ username: 'release-viewer', password: 'Viewer@1234!' });

    const report = await viewerAgent.get('/api/release/report');
    expect(report.status).toBe(200);
    expect(report.body.environments.map((environment: any) => environment.name)).toEqual(['DEV', 'QA', 'PROD']);

    const promote = await viewerAgent.post('/api/release/promote').send({ target: 'QA' });
    expect(promote.status).toBe(403);
    expect(promote.body.error).toBe('Admin access required');
  });

  it('allows admins to approve QA before PROD release promotion', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'admin', password: 'Admin@1234!' });

    const prodBeforeQa = await agent.post('/api/release/promote').send({ target: 'PROD' });
    expect(prodBeforeQa.status).toBe(409);
    expect(prodBeforeQa.body.error).toBe('QA must be approved before PROD');

    const qa = await agent.post('/api/release/promote').send({ target: 'QA' });
    expect(qa.status).toBe(201);
    expect(qa.body.currentStage).toBe('QA');
    expect(qa.body.environments.find((environment: any) => environment.name === 'QA').push.pushedBy).toBe('admin');

    const prod = await agent.post('/api/release/promote').send({ target: 'PROD' });
    expect(prod.status).toBe(201);
    expect(prod.body.currentStage).toBe('PROD');
    expect(prod.body.overallStatus).toBe('released');
    expect(prod.body.environments.find((environment: any) => environment.name === 'PROD').status).toBe('passed');
  });
});
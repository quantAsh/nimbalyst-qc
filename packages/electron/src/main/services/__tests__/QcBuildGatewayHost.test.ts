// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
const appPath = vi.hoisted(() => ({ value: '' }));
vi.mock('electron', () => ({ app: { getPath: () => appPath.value } }));
import { setMcpAuthTokenForTest } from '../../mcp/mcpAuth';
import { configureQcBuildGateway, handleQcBuildRequest } from '../QcBuildGatewayHost';

describe('build HTTP boundary', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'qc-build-test-'));
    appPath.value = directory;
    mkdirSync(join(directory, 'repo'));
    const config = join(directory, 'config.json');
    writeFileSync(config, JSON.stringify({ ownerOnly: true, bindings: [{ organizationId: 'org-a', workspaceId: 'ws-a', workspacePath: join(directory, 'repo') }] }));
    process.env.NIMBALYST_QC_BUILD_CONFIG = config;
    setMcpAuthTokenForTest('launch-token');
    configureQcBuildGateway({ createDraft: async () => 'session-a', getSession: async () => null, openSession: vi.fn(async () => {}), cancelSession: async () => {} });
  });
  afterEach(() => {
    delete process.env.NIMBALYST_QC_BUILD_CONFIG;
    configureQcBuildGateway({ createDraft: async () => 'session-a', getSession: async () => null, openSession: vi.fn(async () => {}), cancelSession: async () => {} });
    setMcpAuthTokenForTest(null);
    rmSync(directory, { recursive: true, force: true });
  });

  async function call(headers: Record<string, string>, raw: string) {
    const req = Object.assign(Readable.from([raw]), { method: 'POST', headers }) as unknown as IncomingMessage;
    const result = { status: 0, body: '' };
    const res = { setHeader() {}, writeHead(status: number) { result.status = status; }, end(body: string) { result.body = body; } } as unknown as ServerResponse;
    await handleQcBuildRequest(req, res, '/v1/projects');
    return result;
  }

  it('requires per-launch authentication, rejects browser origins and malformed/oversized requests', async () => {
    const headers = { authorization: 'Bearer launch-token', 'content-type': 'application/json' };
    expect((await call({}, '{}')).status).toBe(401);
    expect((await call({ ...headers, origin: 'https://attacker.example' }, '{}')).status).toBe(401);
    expect((await call(headers, '[')).status).toBe(400);
    expect((await call(headers, 'a'.repeat(65537))).status).toBe(413);
    expect((await call(headers, JSON.stringify({ projectId: 'p', organizationId: 'other', workspaceId: 'ws-a', name: 'Project' }))).status).toBe(403);
    const created = await call(headers, JSON.stringify({ projectId: 'p', organizationId: 'org-a', workspaceId: 'ws-a', name: 'Project' }));
    expect(created.status).toBe(200);
    expect(JSON.parse(created.body).deepLink).toMatch(/^qc-nimbalyst:\/\/project\//);
  });
});

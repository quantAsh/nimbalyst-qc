// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, chmodSync, rmSync } from 'node:fs';
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
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'qc-build-test-')));
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
    vi.unstubAllGlobals();
  });

  async function call(headers: Record<string, string>, raw: string, pathname='/v1/projects',method='POST') {
    const req = Object.assign(Readable.from([raw]), { method, headers }) as unknown as IncomingMessage;
    const result = { status: 0, body: '' };
    const res = { setHeader() {}, writeHead(status: number) { result.status = status; }, end(body: string) { result.body = body; } } as unknown as ServerResponse;
    await handleQcBuildRequest(req, res, pathname);
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

  it('subscribes to actual completion events, persists an acknowledged notice and omits objectives/secrets',async()=>{
    const callback={url:'http://127.0.0.1:8897/api/build-control/callbacks/nimbalyst',secret:'disposable-native-callback-secret-32'};
    const config=join(directory,'config.json');
    writeFileSync(config,JSON.stringify({ownerOnly:true,bindings:[{organizationId:'org-a',workspaceId:'ws-a',workspacePath:join(directory,'repo')}],callback}),{mode:0o600});
    // The pre-existing config was created with default permissions.
    chmodSync(config,0o600);
    let notify!:(event:{type:string;sessionId:string;timestamp:Date})=>void;
    let status='awaiting_approval';
    const transport=vi.fn(async(_url,options)=>{const body=JSON.parse(options.body);return {status:200,json:async()=>({eventId:body.eventId,sessionId:body.sessionId,workspaceId:body.workspaceId})};});
    vi.stubGlobal('fetch',transport);
    configureQcBuildGateway({createDraft:async()=> 'session-a',getSession:async id=>({id,workspacePath:join(directory,'repo'),status}),openSession:async()=>{},cancelSession:async()=>{},subscribeNativeEvents:listener=>{notify=listener;return vi.fn();}});
    const headers={authorization:'Bearer launch-token','content-type':'application/json'};
    const project=JSON.parse((await call(headers,JSON.stringify({projectId:'project-a',organizationId:'org-a',workspaceId:'ws-a',name:'Bound'}))).body);
    expect((await call(headers,JSON.stringify({project_id:project.id,session_id:'platform-a',organization_id:'org-a',workspace_id:'ws-a',objective:'private objective'}),'/v1/sessions')).status).toBe(200);
    status='idle';notify({type:'session:completed',sessionId:'session-a',timestamp:new Date()});
    await vi.waitFor(()=>expect(JSON.parse(readFileSync(join(directory,'qc-native-evidence-outbox.json'),'utf8')).acknowledged).toHaveLength(1));
    const body=transport.mock.calls[0][1].body;
    expect(body).not.toContain('private objective');expect(body).not.toContain(callback.secret);
    expect(JSON.parse((await call(headers,'','/v1/sessions/session-a','GET')).body).evidenceExport).toMatchObject({configured:true,pending:0,error:null});
  });

  it('leaves the gateway disabled when callback configuration is unsafe',async()=>{
    const config=join(directory,'config.json');
    writeFileSync(config,JSON.stringify({ownerOnly:true,bindings:[{organizationId:'org-a',workspaceId:'ws-a',workspacePath:join(directory,'repo')}],callback:{url:'https://external.example/callback',secret:'disposable-native-callback-secret-32'}}));
    expect(()=>configureQcBuildGateway({createDraft:async()=> 'session-a',getSession:async()=>null,openSession:async()=>{},cancelSession:async()=>{},subscribeNativeEvents:()=>()=>{}})).toThrow('owner-only');
    expect((await call({authorization:'Bearer launch-token','content-type':'application/json'},'{}')).status).toBe(503);
  });
});

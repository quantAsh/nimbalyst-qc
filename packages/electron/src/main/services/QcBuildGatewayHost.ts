import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BuildGatewayError, QcBuildGateway, type BuildBinding, type BuildGatewayDeps, type BuildGatewayState } from './QcBuildGateway';
import { requireMcpAuth } from '../mcp/mcpAuth';

let gateway: QcBuildGateway | null = null;

/** Explicit owner-only opt-in. No provider credentials or automatic agent execution. */
export function configureQcBuildGateway(deps: Omit<BuildGatewayDeps, 'save'>): void {
  gateway = null;
  const configPath = process.env.NIMBALYST_QC_BUILD_CONFIG;
  if (!configPath) return;
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { ownerOnly?: boolean; bindings?: BuildBinding[] };
  if (config.ownerOnly !== true || !Array.isArray(config.bindings) || !config.bindings.length) throw new Error('QC build gateway requires explicit ownerOnly bindings');
  const seen = new Set<string>();
  const paths = new Set<string>();
  const bindings = config.bindings.map(binding => {
    if (!binding || !binding.organizationId || !binding.workspaceId || !path.isAbsolute(binding.workspacePath)) throw new Error('Invalid QC build binding');
    const workspacePath = fs.realpathSync(binding.workspacePath);
    if (!fs.statSync(workspacePath).isDirectory()) throw new Error('QC build binding must be a directory');
    const key = `${binding.organizationId}:${binding.workspaceId}`;
    if (seen.has(key) || paths.has(workspacePath)) throw new Error('QC build bindings must use distinct workspace identities and directories');
    seen.add(key);
    paths.add(workspacePath);
    return { organizationId: binding.organizationId, workspaceId: binding.workspaceId, workspacePath };
  });
  const stateFile = path.join(app.getPath('userData'), 'qc-build-gateway-state.json');
  const state: BuildGatewayState = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { projects: {}, sessions: {} };
  if (!state.projects || !state.sessions) throw new Error('Invalid QC build gateway state; preserve the file for recovery');
  const save = (next: BuildGatewayState) => {
    const temp = `${stateFile}.pending`;
    fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, stateFile);
  };
  gateway = new QcBuildGateway(bindings, state, { ...deps, save });
}

export function resolveQcBuildLink(url: string) {
  return gateway?.resolveLink(url) || null;
}

export async function handleQcBuildRequest(req: IncomingMessage, res: ServerResponse, pathname: string | null): Promise<boolean> {
  if (!pathname?.startsWith('/v1/')) return false;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const send = (status: number, body: unknown) => { res.writeHead(status); res.end(JSON.stringify(body)); };
  if (!gateway) { send(503, { detail: 'Owner-only build gateway is not enabled' }); return true; }
  if (req.headers.origin || !requireMcpAuth(req)) { send(401, { detail: 'Local gateway authentication required' }); return true; }
  try {
    let raw = '';
    if (req.method !== 'GET') {
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new BuildGatewayError(415, 'JSON content type required');
      for await (const chunk of req) {
        raw += chunk.toString();
        if (Buffer.byteLength(raw) > 65536) throw new BuildGatewayError(413, 'Build request is too large');
      }
    }
    let payload: unknown = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { throw new BuildGatewayError(400, 'Invalid JSON'); }
    send(200, await gateway.dispatch(req.method || '', pathname, payload));
  } catch (error) {
    send(error instanceof BuildGatewayError ? error.status : 503, { detail: error instanceof BuildGatewayError ? error.message : 'Native build operation failed' });
  }
  return true;
}

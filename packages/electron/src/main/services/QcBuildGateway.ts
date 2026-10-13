import { randomUUID } from 'node:crypto';

export interface BuildBinding {
  organizationId: string;
  workspaceId: string;
  workspacePath: string;
}
interface ProjectRecord extends BuildBinding {
  id: string;
  platformId: string;
  sandboxPolicy: Record<string, unknown>;
}
interface SessionRecord extends BuildBinding {
  id: string;
  platformId: string;
  projectId: string;
  cancelled?: boolean;
  artifacts: Array<{ id: string; kind: string; summary: string }>;
}
export interface BuildGatewayState {
  projects: Record<string, ProjectRecord>;
  sessions: Record<string, SessionRecord>;
}
export interface DraftRequest {
  objective: string;
  contextRefs: string[];
  sandboxPolicy: Record<string, unknown>;
}
export interface BuildGatewayDeps {
  createDraft(binding: BuildBinding, request: DraftRequest): Promise<string>;
  getSession(id: string): Promise<{ id: string; workspacePath: string; status: string } | null>;
  cancelSession(id: string): Promise<void>;
  openSession(id: string): Promise<void>;
  save(state: BuildGatewayState): void;
}
export class BuildGatewayError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const opaque = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._-]{1,200}$/.test(value);

/** Owner-only local handoff. Creates native drafts; never bypasses desktop consent. */
export class QcBuildGateway {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private bindings: BuildBinding[], private state: BuildGatewayState, private deps: BuildGatewayDeps) {}

  dispatch(method: string, path: string, payload: unknown): Promise<Record<string, unknown>> {
    const operation = this.queue.then(async () => {
      const before = JSON.parse(JSON.stringify(this.state)) as BuildGatewayState;
      try { return await this.handle(method, path, payload); }
      catch (error) { this.state = before; throw error; }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private binding(org: unknown, workspace: unknown): BuildBinding {
    const bound = this.bindings.find(item => item.organizationId === org && item.workspaceId === workspace);
    if (!bound) throw new BuildGatewayError(403, 'Workspace is not bound to this owner-only gateway');
    return bound;
  }

  private checkScope(record: BuildBinding): void {
    if (this.binding(record.organizationId, record.workspaceId).workspacePath !== record.workspacePath) throw new BuildGatewayError(403, 'Build scope has changed');
  }

  private async native(record: SessionRecord) {
    this.checkScope(record);
    const native = await this.deps.getSession(record.id);
    if (!native) throw new BuildGatewayError(404, 'Native session not found');
    if (native.id !== record.id || native.workspacePath !== record.workspacePath) throw new BuildGatewayError(403, 'Native session scope mismatch');
    return native;
  }

  private async handle(method: string, path: string, payload: unknown): Promise<Record<string, unknown>> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new BuildGatewayError(400, 'JSON must be an object');
    const body = payload as Record<string, unknown>;
    if (method === 'POST' && path === '/v1/projects') {
      const bound = this.binding(body.organizationId, body.workspaceId);
      if (!opaque(body.projectId) || typeof body.name !== 'string' || !body.name.trim()) throw new BuildGatewayError(400, 'Project id and name are required');
      const previous = Object.values(this.state.projects).find(item => item.platformId === body.projectId);
      if (previous) {
        if (previous.workspaceId !== bound.workspaceId || previous.organizationId !== bound.organizationId) throw new BuildGatewayError(403, 'Project scope mismatch');
        return { id: previous.id, status: 'active', deepLink: `qc-nimbalyst://project/${previous.id}` };
      }
      const id = `qc-project-${randomUUID()}`;
      this.state.projects[id] = { ...bound, id, platformId: body.projectId, sandboxPolicy: (body.sandboxPolicy || {}) as Record<string, unknown> };
      this.deps.save(this.state);
      return { id, status: 'active', deepLink: `qc-nimbalyst://project/${id}` };
    }
    if (method === 'POST' && path === '/v1/sessions') {
      const project = this.state.projects[String(body.project_id)];
      if (!project) throw new BuildGatewayError(404, 'Project not found');
      this.checkScope(project);
      if (body.organization_id !== project.organizationId || body.workspace_id !== project.workspaceId) throw new BuildGatewayError(403, 'Session scope mismatch');
      if (!opaque(body.session_id) || typeof body.objective !== 'string' || !body.objective.trim() || body.objective.length > 8000) throw new BuildGatewayError(400, 'Session id and objective are required');
      const refs = body.context_pack_refs || [];
      if (!Array.isArray(refs) || refs.some(ref => typeof ref !== 'string' || !ref.startsWith('ctx://'))) throw new BuildGatewayError(400, 'Context requires approved ctx:// references');
      const previous = Object.values(this.state.sessions).find(item => item.platformId === body.session_id);
      if (previous) {
        if (previous.projectId !== project.id) throw new BuildGatewayError(403, 'Session scope mismatch');
        const native = await this.native(previous);
        return { id: previous.id, status: previous.cancelled ? 'cancelled' : native.status, deepLink: `qc-nimbalyst://session/${previous.id}` };
      }
      const id = await this.deps.createDraft(project, { objective: body.objective, contextRefs: refs as string[], sandboxPolicy: project.sandboxPolicy });
      if (!opaque(id)) throw new BuildGatewayError(502, 'Native session did not return a valid id');
      const record: SessionRecord = { ...project, id, platformId: body.session_id, projectId: project.id, artifacts: [] };
      await this.native(record);
      this.state.sessions[id] = record;
      this.deps.save(this.state);
      return { id, status: 'awaiting_approval', deepLink: `qc-nimbalyst://session/${id}` };
    }
    const match = /^\/v1\/sessions\/([A-Za-z0-9._-]+)(?:\/(cancel|artifacts|open))?$/.exec(path);
    if (match) {
      const record = this.state.sessions[match[1]];
      if (!record) throw new BuildGatewayError(404, 'Session not found');
      const native = await this.native(record);
      if (method === 'GET' && !match[2]) return { id: record.id, status: record.cancelled ? 'cancelled' : native.status, deepLink: `qc-nimbalyst://session/${record.id}` };
      if (method === 'POST' && match[2] === 'open') {
        await this.deps.openSession(record.id);
        return { id: record.id, opened: true };
      }
      if (method === 'POST' && match[2] === 'cancel') {
        await this.deps.cancelSession(record.id);
        record.cancelled = true;
        this.deps.save(this.state);
        return { id: record.id, status: 'cancelled' };
      }
      if (method === 'POST' && match[2] === 'artifacts') {
        if (!['diff', 'test', 'checkpoint'].includes(String(body.kind)) || typeof body.summary !== 'string' || body.summary.length > 800) throw new BuildGatewayError(400, 'Invalid artifact');
        const artifact = { id: randomUUID(), kind: String(body.kind), summary: body.summary };
        record.artifacts.push(artifact);
        this.deps.save(this.state);
        return { id: artifact.id };
      }
    }
    throw new BuildGatewayError(404, 'Build endpoint not found');
  }

  resolveLink(url: string): { workspacePath: string; sessionId?: string } | null {
    try {
      const parsed = new URL(url);
      if (!['nimbalyst:', 'qc-nimbalyst:'].includes(parsed.protocol) || parsed.search || parsed.hash) return null;
      const id = parsed.pathname.slice(1);
      if (!opaque(id)) return null;
      const record = parsed.hostname === 'session' ? this.state.sessions[id] : parsed.hostname === 'project' ? this.state.projects[id] : null;
      if (!record) return null;
      this.checkScope(record);
      return { workspacePath: record.workspacePath, ...(parsed.hostname === 'session' ? { sessionId: id } : {}) };
    } catch { return null; }
  }

  async evidenceBinding(id:string){
    const record=this.state.sessions[id];
    if(!record)return null;
    const native=await this.native(record);
    return {id:record.id,organizationId:record.organizationId,workspaceId:record.workspaceId,status:record.cancelled?'cancelled':native.status};
  }
}

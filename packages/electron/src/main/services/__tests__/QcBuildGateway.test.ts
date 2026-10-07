// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { QcBuildGateway } from '../QcBuildGateway';

const binding = { organizationId: 'org-a', workspaceId: 'ws-a', workspacePath: '/owner/approved-repo' };
const request = { projectId: 'platform-project', organizationId: 'org-a', workspaceId: 'ws-a', name: 'Approved build', sandboxPolicy: { network_egress: [], tool_allowlist: ['read', 'search', 'test', 'diff'] } };

function setup() {
  const deps = {
    createDraft: vi.fn(async () => 'native-session'),
    getSession: vi.fn(async () => ({ id: 'native-session', workspacePath: binding.workspacePath, status: 'awaiting_approval' })),
    cancelSession: vi.fn(async () => {}),
    openSession: vi.fn(async () => {}),
    save: vi.fn(),
  };
  return { deps, gateway: new QcBuildGateway([binding], { projects: {}, sessions: {} }, deps) };
}

describe('owner-only build gateway', () => {
  it('creates a real native draft, preserves policy, and resolves only bound deep links', async () => {
    const { gateway, deps } = setup();
    const project = await gateway.dispatch('POST', '/v1/projects', request);
    const session = await gateway.dispatch('POST', '/v1/sessions', { session_id: 'platform-session', project_id: project.id, organization_id: 'org-a', workspace_id: 'ws-a', objective: 'Review and build', context_pack_refs: ['ctx://approved/brief'], sandbox_policy: request.sandboxPolicy });
    expect(session).toMatchObject({ id: 'native-session', status: 'awaiting_approval', deepLink: 'qc-nimbalyst://session/native-session' });
    expect(deps.createDraft).toHaveBeenCalledWith(expect.objectContaining(binding), expect.objectContaining({ objective: 'Review and build', sandboxPolicy: request.sandboxPolicy }));
    expect(gateway.resolveLink('qc-nimbalyst://session/native-session')).toEqual({ workspacePath: binding.workspacePath, sessionId: 'native-session' });
    expect(gateway.resolveLink('nimbalyst://session/other-session')).toBeNull();
    expect(gateway.resolveLink('nimbalyst://project/unbound')).toBeNull();
    expect(deps.save).toHaveBeenCalled();
    expect(await gateway.dispatch('POST', '/v1/sessions/native-session/open', {})).toMatchObject({id: 'native-session', opened: true});
    expect(deps.openSession).toHaveBeenCalledWith('native-session');
    deps.getSession.mockResolvedValueOnce({id: 'native-session', workspacePath: '/other', status: 'running'});
    await expect(gateway.dispatch('POST', '/v1/sessions/native-session/open', {})).rejects.toThrow('scope');
    expect(deps.openSession).toHaveBeenCalledTimes(1);
  });

  it('denies cross-tenant creation and stale native scope, and requires confirmed cancellation', async () => {
    const { gateway, deps } = setup();
    await expect(gateway.dispatch('POST', '/v1/projects', { ...request, organizationId: 'org-b' })).rejects.toThrow('not bound');
    const project = await gateway.dispatch('POST', '/v1/projects', request);
    const payload = { session_id: 's', project_id: project.id, organization_id: 'org-a', workspace_id: 'ws-a', objective: 'Draft', context_pack_refs: [] };
    await expect(gateway.dispatch('POST', '/v1/sessions', { ...payload, workspace_id: 'ws-b' })).rejects.toThrow('scope');
    await gateway.dispatch('POST', '/v1/sessions', payload);
    deps.cancelSession.mockRejectedValueOnce(new Error('Cannot abort'));
    await expect(gateway.dispatch('POST', '/v1/sessions/native-session/cancel', {})).rejects.toThrow('Cannot abort');
    expect((await gateway.dispatch('GET', '/v1/sessions/native-session', {})).status).toBe('awaiting_approval');
    deps.getSession.mockResolvedValueOnce({ id: 'native-session', workspacePath: '/another/repo', status: 'running' });
    await expect(gateway.dispatch('GET', '/v1/sessions/native-session', {})).rejects.toThrow('scope');
    await expect(gateway.dispatch('POST', '/v1/sessions', { ...payload, context_pack_refs: ['/raw/private-data'] })).rejects.toThrow('ctx://');
  });

  it('deduplicates retried creation and refuses invalid context before native creation', async () => {
    const { gateway, deps } = setup();
    const project = await gateway.dispatch('POST', '/v1/projects', request);
    expect((await gateway.dispatch('POST', '/v1/projects', request)).id).toBe(project.id);
    const payload = { session_id: 'retry-session', project_id: project.id, organization_id: 'org-a', workspace_id: 'ws-a', objective: 'Draft', context_pack_refs: [] };
    await gateway.dispatch('POST', '/v1/sessions', payload);
    await gateway.dispatch('POST', '/v1/sessions', payload);
    expect(deps.createDraft).toHaveBeenCalledTimes(1);
    await expect(gateway.dispatch('POST', '/v1/sessions', { ...payload, session_id: 'invalid', context_pack_refs: ['file:///private/data'] })).rejects.toThrow('ctx://');
    expect(deps.createDraft).toHaveBeenCalledTimes(1);
  });
});

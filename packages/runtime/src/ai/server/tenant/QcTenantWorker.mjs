/** Headless tenant controller. All models, context and tools stay behind the broker. */
export async function runTenantWorker(config, transport = fetch) {
  const origin = new URL(config.origin);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
      !(origin.protocol === 'https:' || origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) ||
      !/^nim-job-[a-f0-9]{32}$/.test(config.jobId) || typeof config.grant !== 'string' || config.grant.length > 8192) {
    throw new Error('Invalid tenant broker configuration');
  }
  const base = `${origin.origin}/api/build-control/tenant-workers/${config.jobId}`;
  const call = async path => {
    const response = await transport(`${base}${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.grant}` },
      redirect: 'error', signal: AbortSignal.timeout(75000),
    });
    if (!response.ok) throw new Error('Tenant broker rejected worker operation');
    const body = await response.text();
    if (body.length > 16384) throw new Error('Tenant broker response limit');
    return JSON.parse(body);
  };
  // Server budgets and durable claims are authoritative. This is a second bound.
  for (let turn = 0; turn < 9; turn++) {
    const step = await call('/step');
    if (step.status === 'awaiting_review') return { status: 'awaiting_review' };
    if (step.status !== 'running' || !Array.isArray(step.toolCalls) || step.toolCalls.length > 16) throw new Error('Invalid tenant step');
    for (const id of step.toolCalls) {
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error('Invalid broker tool call');
      await call(`/tools/${encodeURIComponent(id)}`);
    }
  }
  throw new Error('Tenant worker turn limit reached');
}

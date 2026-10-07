import { runTenantWorker } from '../packages/runtime/src/ai/server/tenant/QcTenantWorker.mjs';
// The capability arrives through stdin, never argv, files or inherited credentials.
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (input.length > 16384) throw new Error('Worker input limit');
  }
  await runTenantWorker(JSON.parse(input));
} catch {
  process.stderr.write('Tenant worker stopped before review.\n');
  process.exitCode = 1;
}

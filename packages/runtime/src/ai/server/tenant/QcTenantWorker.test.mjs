import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTenantWorker } from './QcTenantWorker.mjs';
const config = {origin:'http://127.0.0.1:8888', jobId:'nim-job-'+'a'.repeat(32),grant:'scoped-capability'};

test('routes only broker-issued opaque calls and stops at human review', async () => {
  const calls=[];
  const transport=async(url,options)=>{
    calls.push({url,options});
    const data=calls.length===1?{status:'running',toolCalls:['call_1']} : calls.length===2?{status:'running'} : {status:'awaiting_review'};
    return {ok:true,text:async()=>JSON.stringify(data)};
  };
  assert.deepEqual(await runTenantWorker(config,transport),{status:'awaiting_review'});
  assert.match(calls[1].url,/\/tools\/call_1$/);
  assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.headers.Authorization,'Bearer scoped-capability');
});

test('rejects unsafe origins, injected call paths, failed transports and endless work',async()=>{
  await assert.rejects(runTenantWorker({...config,origin:'http://remote.example'},async()=>{}));
  await assert.rejects(runTenantWorker(config,async()=>({ok:true,text:async()=>JSON.stringify({status:'running',toolCalls:['../cancel']})})));
  await assert.rejects(runTenantWorker(config,async()=>({ok:false})),/rejected/);
  await assert.rejects(runTenantWorker(config,async()=>({ok:true,text:async()=>JSON.stringify({status:'running',toolCalls:[]})})),/turn limit/);
});

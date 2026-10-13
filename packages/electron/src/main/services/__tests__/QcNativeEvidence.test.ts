// @vitest-environment node
import {createHmac} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {QcNativeEvidence} from '../QcNativeEvidence';
const config={url:'http://127.0.0.1:8897/api/build-control/callbacks/nimbalyst',secret:'disposable-evidence-callback-secret-32'};
const scope={id:'native-a',organizationId:'org-a',workspaceId:'ws-a',status:'idle'};

it('persists notices through failure/restart, signs fresh delivery attempts and deduplicates acknowledgments',async()=>{
  let saved:any={pending:[],acknowledged:[]};
  const request=vi.fn().mockRejectedValueOnce(new Error('private transport details')).mockImplementation(async(_url,options)=>{
    const body=JSON.parse(options.body);
    expect(options.headers['X-Nimbalyst-Signature']).toBe('sha256='+createHmac('sha256',config.secret).update(options.body).digest('hex'));
    expect(Object.keys(body).sort()).toEqual(['deliveredAt','eventId','eventType','occurredAt','organizationId','sessionId','workspaceId']);
    return {status:200,json:async()=>({eventId:body.eventId,sessionId:body.sessionId,workspaceId:body.workspaceId})};
  });
  const deps={binding:vi.fn(async()=>scope),save:(next:any)=>{saved=JSON.parse(JSON.stringify(next));},fetch:request};
  const first=new QcNativeEvidence(config,saved,deps);
  const occurred=new Date().toISOString();
  await first.enqueue('native-a',occurred);await first.flush();
  expect(saved.pending).toHaveLength(1);expect(first.status('native-a').error).not.toContain('private');
  const resumed=new QcNativeEvidence(config,saved,deps);await resumed.flush();
  expect(saved.pending).toHaveLength(0);expect(saved.acknowledged).toHaveLength(1);
  await resumed.enqueue('native-a',occurred);await resumed.flush();expect(request).toHaveBeenCalledTimes(2);
  expect(resumed.status('native-a')).toMatchObject({configured:true,pending:0,error:null});
});

it('rejects remote or ambiguous destinations, skips drafts and refuses foreign binding before delivery',async()=>{
  const fetch=vi.fn();const deps={binding:vi.fn(async()=>({...scope,status:'awaiting_approval'})),save:vi.fn(),fetch};
  for(const url of ['https://external.example/api/build-control/callbacks/nimbalyst','http://127.0.0.1:8897/wrong','http://user@127.0.0.1:8897/api/build-control/callbacks/nimbalyst','http://127.0.0.1:8897/api/build-control/callbacks/nimbalyst?token=private']){
    expect(()=>new QcNativeEvidence({...config,url},{pending:[],acknowledged:[]},deps)).toThrow('callback');
  }
  const outbox=new QcNativeEvidence(config,{pending:[],acknowledged:[]},deps);
  await outbox.enqueue('native-a',new Date().toISOString());expect(outbox.status('native-a').pending).toBe(0);
  deps.binding.mockResolvedValue({...scope,status:'idle'});await outbox.enqueue('native-a',new Date().toISOString());
  deps.binding.mockResolvedValue({...scope,workspaceId:'foreign',status:'idle'});await outbox.flush();
  expect(fetch).not.toHaveBeenCalled();expect(outbox.status('native-a').pending).toBe(1);
});

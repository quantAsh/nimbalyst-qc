import {createHash,createHmac} from 'node:crypto';

export interface NativeEvidenceNotice {
  eventType:'native_evidence_ready';eventId:string;sessionId:string;
  organizationId:string;workspaceId:string;occurredAt:string;
}
export interface NativeEvidenceState {
  pending:NativeEvidenceNotice[];acknowledged:string[];error?:string|null;
}
interface CallbackConfig {url:string;secret:string}
interface Binding {id:string;organizationId:string;workspaceId:string;status:string}
interface Dependencies {
  binding(id:string):Promise<Binding|null>;
  save(state:NativeEvidenceState):void;
  fetch?:typeof fetch;
}
const MAX_PENDING=128;
const MESSAGE='Native evidence delivery is pending; check the configured local platform connection.';

/** Durable metadata-only completion notices. Source and test claims never come from chat. */
export class QcNativeEvidence {
  private serial:Promise<unknown>=Promise.resolve();
  private state:NativeEvidenceState;
  constructor(private config:CallbackConfig,state:NativeEvidenceState,private deps:Dependencies){
    let url:URL;
    try{url=new URL(config.url);}catch{throw new Error('Invalid native evidence callback configuration');}
    if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!='/api/build-control/callbacks/nimbalyst'||typeof config.secret!=='string'||config.secret.length<32||config.secret.length>4096){
      throw new Error('Invalid native evidence callback configuration');
    }
    if(!Array.isArray(state.pending)||!Array.isArray(state.acknowledged)||state.pending.length>MAX_PENDING||state.acknowledged.length>512)throw new Error('Invalid native evidence outbox; preserve it for recovery');
    for(const notice of state.pending){
      if(!notice||notice.eventType!=='native_evidence_ready'||!['eventId','sessionId','organizationId','workspaceId','occurredAt'].every(key=>typeof notice[key as keyof NativeEvidenceNotice]==='string'&&String(notice[key as keyof NativeEvidenceNotice]).length<=200)||Object.keys(notice).length!==6)throw new Error('Invalid native evidence outbox; preserve it for recovery');
    }
    if(state.acknowledged.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)))throw new Error('Invalid native evidence outbox; preserve it for recovery');
    this.state=JSON.parse(JSON.stringify(state));
  }
  private run<T>(operation:()=>Promise<T>):Promise<T>{
    const next=this.serial.then(operation,operation);this.serial=next.catch(()=>undefined);return next;
  }
  status(sessionId:string){
    const pending=this.state.pending.filter(item=>item.sessionId===sessionId).length;
    return {configured:true,pending,error:pending?this.state.error||null:null};
  }
  enqueue(sessionId:string,occurredAt:string):Promise<void>{
    return this.run(async()=>{
      const binding=await this.deps.binding(sessionId);
      if(!binding||binding.id!==sessionId||!['idle','awaiting_review'].includes(binding.status))return;
      if(!Number.isFinite(Date.parse(occurredAt)))throw new Error('Invalid native completion timestamp');
      const eventId=createHash('sha256').update(JSON.stringify([binding.organizationId,binding.workspaceId,sessionId,occurredAt])).digest('hex');
      if(this.state.acknowledged.includes(eventId)||this.state.pending.some(item=>item.eventId===eventId))return;
      if(this.state.pending.length>=MAX_PENDING){this.state.error=MESSAGE;this.deps.save(this.state);throw new Error('Native evidence outbox is full; delivery must recover before adding notices');}
      this.state.pending.push({eventType:'native_evidence_ready',eventId,sessionId,organizationId:binding.organizationId,workspaceId:binding.workspaceId,occurredAt});
      try{this.deps.save(this.state);}catch{this.state.error=MESSAGE;throw new Error('Native evidence notice could not be persisted');}
    });
  }
  flush():Promise<void>{
    return this.run(async()=>{
      for(let count=0;count<10&&this.state.pending.length;count++){
        const notice=this.state.pending[0];
        const before=JSON.parse(JSON.stringify(this.state)) as NativeEvidenceState;
        try{
          const binding=await this.deps.binding(notice.sessionId);
          if(!binding||binding.id!==notice.sessionId||binding.organizationId!==notice.organizationId||binding.workspaceId!==notice.workspaceId||!['idle','awaiting_review','cancelled'].includes(binding.status))throw new Error('Native scope or status changed');
          const body=JSON.stringify({...notice,deliveredAt:new Date().toISOString()});
          const response=await (this.deps.fetch||fetch)(this.config.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json','X-Nimbalyst-Signature':'sha256='+createHmac('sha256',this.config.secret).update(body).digest('hex')},body});
          if(response.status!==200)throw new Error('Callback rejected');
          const ack=await response.json();
          if(ack?.eventId!==notice.eventId||ack?.sessionId!==notice.sessionId||ack?.workspaceId!==notice.workspaceId)throw new Error('Callback acknowledgment mismatch');
          this.state.pending.shift();this.state.acknowledged=[...this.state.acknowledged,notice.eventId].slice(-512);this.state.error=null;
          this.deps.save(this.state);
        }catch{
          this.state=before;
          this.state.error=MESSAGE;this.deps.save(this.state);return;
        }
      }
    });
  }
}

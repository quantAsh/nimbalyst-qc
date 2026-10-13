// @vitest-environment node
import {expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({posthog:vi.fn(),write:vi.fn(),legacy:{enabled:true,enabledProjects:['private-project'],environment:'production'}}));
vi.mock('electron-store',()=>({default:class {
  path='disposable-settings';
  get(key:string,fallback?:unknown){return key==='analyticsEnabled'?true:key==='sessionSync'?mocks.legacy:key==='analyticsId'?'disposable-id':fallback;}
  set(...args:unknown[]){mocks.write(...args);}
  delete(){}
}}));
vi.mock('posthog-node',()=>({PostHog:class {constructor(){mocks.posthog();}capture(){}isFeatureEnabled(){return true;}async optIn(){}async optOut(){}}}));
vi.mock('electron',()=>({app:{getVersion:()=> 'qc-test',getPath:()=> '/disposable'}}));
vi.mock('../../../utils/logger',()=>({logger:{analytics:{info:vi.fn(),error:vi.fn(),warn:vi.fn(),debug:vi.fn()}}}));
import {AnalyticsService} from '../AnalyticsService';
import {isAnalyticsEnabled,getSessionSyncConfig,setSessionSyncConfig} from '../../../utils/store';
import {getCollabSyncWsUrl} from '../../../utils/collabSyncUrl';

it('never initializes upstream telemetry and ignores legacy cloud-sync opt-in without rewriting it',async()=>{
  const service=AnalyticsService.getInstance();
  service.init();service.sendEvent('private-event',{workspace:'private'});service.setSessionId('native-session');
  expect(mocks.posthog).not.toHaveBeenCalled();
  expect(service.allowedToSendAnalytics()).toBe(false);expect(isAnalyticsEnabled()).toBe(false);
  expect(await service.getFeatureFlag('some-flag')).toBeNull();
  await expect(service.optIn()).rejects.toThrow('QC');
  expect(getSessionSyncConfig()).toMatchObject({enabled:false,enabledProjects:[]});
  expect(mocks.legacy.enabled).toBe(true);expect(mocks.write).not.toHaveBeenCalled();
  expect(()=>setSessionSyncConfig(mocks.legacy as any)).toThrow('QC');
  expect(()=>getCollabSyncWsUrl()).toThrow('QC');
});

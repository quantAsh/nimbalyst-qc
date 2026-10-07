// @vitest-environment node
import {it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({updater:{logger:null,autoDownload:true,autoInstallOnAppQuit:true,setFeedURL:vi.fn(),on:vi.fn(),checkForUpdates:vi.fn(),checkForUpdatesAndNotify:vi.fn(),downloadUpdate:vi.fn(),quitAndInstall:vi.fn()},handlers:new Map<string,Function>(),events:new Map<string,Function>()}));
vi.mock('electron-updater',()=>({autoUpdater:mocks.updater}));
vi.mock('electron',()=>({app:{getVersion:()=> 'custom'},BrowserWindow:{getFocusedWindow:()=>null,getAllWindows:()=>[]},dialog:{}}));
vi.mock('electron-log/main',()=>({default:{transports:{file:{}},info:vi.fn(),warn:vi.fn(),error:vi.fn()}}));
vi.mock('../../utils/store',()=>({getReleaseChannel:()=> 'stable',store:{get:vi.fn(),set:vi.fn()}}));
vi.mock('../../utils/ipcRegistry',()=>({safeHandle:(key:string,fn:Function)=>mocks.handlers.set(key,fn),safeOn:(key:string,fn:Function)=>mocks.events.set(key,fn)}));
vi.mock('../analytics/AnalyticsService',()=>({AnalyticsService:{getInstance:()=>({sendEvent:vi.fn()})}}));
vi.mock('../../ipc/SessionStateHandlers',()=>({hasActiveStreamingSessions:()=>false}));
vi.mock('@nimbalyst/runtime/ai/server/SessionStateManager',()=>({getSessionStateManager:()=>({subscribe:vi.fn()})}));
vi.mock('../../database/initialize',()=>({getDatabase:vi.fn()}));
vi.mock('../electronUpdaterPatch',()=>({installAtomFeedFilter:vi.fn()}));
import {AutoUpdaterService} from '../autoUpdater';
it('blocks upstream feed, network checks, downloads and installation across public and IPC entry points',async()=>{
 const service=new AutoUpdaterService();service.reconfigureFeedURL();service.startAutoUpdateCheck();await service.checkForUpdates();await service.checkForUpdatesWithUI();service.stopAutoUpdateCheck();
 for(const key of ['check-for-updates','download-update','quit-and-install']) expect(await mocks.handlers.get(key)!()).toMatchObject({disabled:true});
 for(const fn of mocks.events.values()) await fn();
 expect(mocks.updater.autoDownload).toBe(false);expect(mocks.updater.autoInstallOnAppQuit).toBe(false);
 for(const key of ['setFeedURL','on','checkForUpdates','checkForUpdatesAndNotify','downloadUpdate','quitAndInstall'] as const) expect(mocks.updater[key]).not.toHaveBeenCalled();
});

// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
const paths = vi.hoisted(() => ({ userData: '/default-user-data', appData: '/default-app-data', imported: [] as string[] }));
vi.mock('electron', () => ({ app: {
  setName: vi.fn(),
  getPath: (key: 'userData' | 'appData') => paths[key],
  setPath: (key: 'userData' | 'appData', value: string) => { paths[key] = value; },
  commandLine: { appendSwitch: vi.fn() },
} }));
vi.mock('electron-store', () => ({ default: class { get(_key: string, fallback: unknown) { return fallback; } } }));
vi.mock('../index', () => { paths.imported.push(paths.userData); return {}; });
vi.mock('../uncaughtException', () => ({ createUncaughtExceptionHandler: () => () => undefined }));
const existingListeners = process.listeners('uncaughtException');
afterEach(() => {
  vi.unstubAllEnvs();
  for (const listener of process.listeners('uncaughtException')) if (!existingListeners.includes(listener)) process.removeListener('uncaughtException', listener);
});
it('selects isolated user data before the desktop module can initialize settings', async () => {
  vi.stubEnv('NIMBALYST_USER_DATA_DIR', '/isolated/user-data');
  await import('../bootstrap');
  await vi.waitFor(() => expect(paths.imported).toEqual(['/isolated/user-data']));
  expect(paths.appData).toBe('/isolated');
});

it('uses a separate custom default profile when no explicit profile is supplied', async () => {
  vi.resetModules();
  vi.stubEnv('NIMBALYST_USER_DATA_DIR', '');
  paths.appData='/default-app-data'; paths.imported=[];
  await import('../bootstrap');
  expect(paths.userData).toBe('/default-app-data/QC Nimbalyst');
  expect((await import('electron')).app.setName).toHaveBeenCalledWith('QC Nimbalyst');
});

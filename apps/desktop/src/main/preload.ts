import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@zyper/shared';

contextBridge.exposeInMainWorld('zyper', {
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.GET_APP_VERSION),
  getSystemInfo: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SYSTEM_INFO),
  apiRequest: (endpoint: string, options?: RequestInit) =>
    ipcRenderer.invoke(IPC_CHANNELS.API_REQUEST, { endpoint, options }),
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL_URL, url),
  onRunEvent: (callback: (event: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.ON_RUN_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.ON_RUN_EVENT, handler);
  },
});

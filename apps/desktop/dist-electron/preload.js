"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const shared_1 = require("@zyper/shared");
electron_1.contextBridge.exposeInMainWorld('zyper', {
    getAppVersion: () => electron_1.ipcRenderer.invoke(shared_1.IPC_CHANNELS.GET_APP_VERSION),
    getSystemInfo: () => electron_1.ipcRenderer.invoke(shared_1.IPC_CHANNELS.GET_SYSTEM_INFO),
    apiRequest: (endpoint, options) => electron_1.ipcRenderer.invoke(shared_1.IPC_CHANNELS.API_REQUEST, { endpoint, options }),
    openExternal: (url) => electron_1.ipcRenderer.invoke(shared_1.IPC_CHANNELS.OPEN_EXTERNAL_URL, url),
    onRunEvent: (callback) => {
        const handler = (_, data) => callback(data);
        electron_1.ipcRenderer.on(shared_1.IPC_CHANNELS.ON_RUN_EVENT, handler);
        return () => electron_1.ipcRenderer.removeListener(shared_1.IPC_CHANNELS.ON_RUN_EVENT, handler);
    },
});

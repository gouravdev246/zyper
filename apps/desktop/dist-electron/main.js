"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const shared_1 = require("@zyper/shared");
let mainWindow = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 960,
        minHeight: 640,
        title: 'Personal AI Operator',
        backgroundColor: '#0a0d14',
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../dist/index.html'));
    }
    // Security: Prevent external window creation except through controlled shell.openExternal
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://') || url.startsWith('http://')) {
            electron_1.shell.openExternal(url);
        }
        return { action: 'deny' };
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
// IPC Handlers
electron_1.ipcMain.handle(shared_1.IPC_CHANNELS.GET_APP_VERSION, () => electron_1.app.getVersion());
electron_1.ipcMain.handle(shared_1.IPC_CHANNELS.GET_SYSTEM_INFO, () => ({
    platform: os_1.default.platform(),
    release: os_1.default.release(),
    arch: os_1.default.arch(),
    hostname: os_1.default.hostname(),
}));
electron_1.ipcMain.handle(shared_1.IPC_CHANNELS.OPEN_EXTERNAL_URL, async (_event, url) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
        await electron_1.shell.openExternal(url);
        return true;
    }
    return false;
});
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});

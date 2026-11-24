import { contextBridge, ipcRenderer } from 'electron';
import type { FfuApi } from './api';

const api: FfuApi = {
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node,
  },
  reportBench: (report) => ipcRenderer.invoke('bench:report', report),
};

contextBridge.exposeInMainWorld('ffu', api);

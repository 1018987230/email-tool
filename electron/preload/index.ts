import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  connect: (email: string, password: string) =>
    ipcRenderer.invoke('email:connect', { email, password }),
  disconnect: () => ipcRenderer.invoke('email:disconnect'),
  startMonitor: () => ipcRenderer.invoke('email:startMonitor'),
  stopMonitor: () => ipcRenderer.invoke('email:stopMonitor'),
  onNewMails: (cb: (list: Array<{ uid: number; subject: string; from: string; date: string; text?: string }>) => void) => {
    ipcRenderer.on('email:newMails', (_, list) => cb(list))
  },
})

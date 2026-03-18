const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  connect: (email, password, imapHost, imapPort, accountName) =>
    ipcRenderer.invoke('email:connect', { email, password, imapHost, imapPort, accountName }),
  disconnect: (accountId) => ipcRenderer.invoke('email:disconnect', accountId),
  listAccounts: () => ipcRenderer.invoke('email:listAccounts'),
  startMonitor: () => ipcRenderer.invoke('email:startMonitor'),
  stopMonitor: () => ipcRenderer.invoke('email:stopMonitor'),
  onNewMails: (cb) => {
    ipcRenderer.on('email:newMails', (_, payload) => cb(payload))
  },
  showNotification: (opts) => ipcRenderer.invoke('app:showNotification', opts),
  getOpenAtLogin: () => ipcRenderer.invoke('app:getOpenAtLogin'),
  setOpenAtLogin: (open) => ipcRenderer.invoke('app:setOpenAtLogin', open),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
})

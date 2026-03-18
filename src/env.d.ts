/// <reference types="vite/client" />

export interface MailItem {
  accountId: string
  accountName: string
  uid: number
  subject: string
  from: string
  date: string
  text?: string
}

export interface AccountInfo {
  accountId: string
  name: string
  email: string
}

interface ElectronAPI {
  connect: (email: string, password: string, imapHost?: string, imapPort?: number, accountName?: string) => Promise<{ ok: boolean; error?: string; host?: string; accountId?: string; accountName?: string }>
  disconnect: (accountId?: string) => Promise<{ ok: boolean }>
  listAccounts: () => Promise<AccountInfo[]>
  startMonitor: () => Promise<{ ok: boolean; error?: string }>
  stopMonitor: () => Promise<{ ok: boolean }>
  onNewMails: (cb: (payload: { accountId: string; accountName: string; list: Omit<MailItem, 'accountId' | 'accountName'>[] }) => void) => void
  showNotification: (opts: { title: string; body: string }) => Promise<void>
  getOpenAtLogin: () => Promise<boolean>
  setOpenAtLogin: (open: boolean) => Promise<void>
  openExternal: (url: string) => Promise<void>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

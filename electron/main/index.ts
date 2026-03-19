import { app, BrowserWindow, ipcMain, Tray, nativeImage, Menu, Notification, shell } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let hasUnreadMails = false
let flashTimer: ReturnType<typeof setInterval> | null = null
const POLL_MS = 8000

// 连接检测和自动重连配置
const CONNECTION_CHECK_INTERVAL = 30000 // 30秒检测一次连接
const MAX_RECONNECT_ATTEMPTS = 5 // 最大重连次数
const RECONNECT_DELAY = 5000 // 重连延迟5秒
let connectionCheckTimer: ReturnType<typeof setInterval> | null = null
let reconnectAttempts: Record<string, number> = {} // 每个账号的重连次数记录
let reconnectTimers: Record<string, ReturnType<typeof setTimeout>> = {}

// 托盘图标路径
function getTrayIconPath() {
  return join(__dirname, '../../email.ico')
}

interface AccountState {
  client: ImapFlow
  lastUid: number
  name: string
  email: string
  host?: string
  port?: number
  password?: string
}
const accounts = new Map<string, AccountState>()
let monitorTimer: ReturnType<typeof setInterval> | null = null

const IMAP_HOSTS: Record<string, { host: string; port: number }> = {
  'gmail.com': { host: 'imap.gmail.com', port: 993 },
  'qq.com': { host: 'imap.qq.com', port: 993 },
  '163.com': { host: 'imap.163.com', port: 993 },
  '126.com': { host: 'imap.126.com', port: 993 },
  'outlook.com': { host: 'outlook.office365.com', port: 993 },
  'hotmail.com': { host: 'outlook.office365.com', port: 993 },
  'yahoo.com': { host: 'imap.mail.yahoo.com', port: 993 },
}

function getImapConfig(email: string): { host: string; port: number } {
  const domain = email.split('@')[1]?.toLowerCase() || ''
  return IMAP_HOSTS[domain] || { host: `imap.${domain}`, port: 993 }
}

function createTray() {
  const iconPath = getTrayIconPath()
  let icon: Electron.NativeImage
  
  try {
    icon = nativeImage.createFromPath(iconPath)
    // Windows 托盘图标建议 16x16，macOS 18x18，Linux 22x22
    if (process.platform === 'win32') {
      icon = icon.resize({ width: 16, height: 16 })
    }
  } catch {
    // 如果加载失败，使用一个空白图标
    icon = nativeImage.createEmpty()
  }
  
  tray = new Tray(icon)
  tray.setToolTip('邮箱监控')
  updateTrayMenu()
  tray.on('double-click', () => {
    mainWindow?.show()
    clearUnreadIndicator()
  })
}

// 更新托盘菜单
function updateTrayMenu() {
  if (!tray) return
  const menu = Menu.buildFromTemplate([
    { 
      label: hasUnreadMails ? '有新邮件！（点击查看）' : '暂无新邮件',
      enabled: hasUnreadMails,
      click: () => {
        mainWindow?.show()
        clearUnreadIndicator()
      }
    },
    { type: 'separator' },
    { label: '显示主窗口', click: () => {
      mainWindow?.show()
      clearUnreadIndicator()
    }},
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu)
  tray.setToolTip(hasUnreadMails ? '【有新邮件】邮箱监控' : '邮箱监控')
}

// 设置未读状态（托盘闪烁）
function setUnreadIndicator() {
  if (hasUnreadMails) return // 已经在闪烁
  hasUnreadMails = true
  updateTrayMenu()
  
  // Windows 上托盘闪烁效果
  if (process.platform === 'win32' && tray) {
    let isHighlight = false
    flashTimer = setInterval(() => {
      if (!tray) {
        clearInterval(flashTimer!)
        return
      }
      // 通过 tooltip 变化引起用户注意
      isHighlight = !isHighlight
      tray.setToolTip(isHighlight ? '🔔 【新邮件】邮箱监控 - 点击查看' : '【有新邮件】邮箱监控')
    }, 800)
  }
  
  // 显示系统通知
  if (Notification.isSupported()) {
    const n = new Notification({
      title: '收到新邮件',
      body: '您有新邮件到达，点击托盘图标查看详情',
      icon: getTrayIconPath()
    })
    n.on('click', () => {
      mainWindow?.show()
      clearUnreadIndicator()
    })
    n.show()
  }
}

// 清除未读状态
function clearUnreadIndicator() {
  if (!hasUnreadMails) return
  hasUnreadMails = false
  if (flashTimer) {
    clearInterval(flashTimer)
    flashTimer = null
  }
  updateTrayMenu()
}

function createWindow() {
  const iconPath = join(__dirname, '../../email.ico')
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'))
  }
  mainWindow.on('closed', () => {
    mainWindow = null
    stopMonitor()
  })
  mainWindow.on('close', (e) => {
    if (tray && !isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  
  // 窗口显示时清除未读状态
  mainWindow.on('show', () => {
    clearUnreadIndicator()
  })
  
  createTray()
}

async function disconnectAccount(accountId: string) {
  const state = accounts.get(accountId)
  if (!state) return
  try {
    await state.client.logout()
  } catch (_) {}
  accounts.delete(accountId)
  // 清除该账号的重连记录
  delete reconnectAttempts[accountId]
  if (reconnectTimers[accountId]) {
    clearTimeout(reconnectTimers[accountId])
    delete reconnectTimers[accountId]
  }
}

// 检查单个账号连接状态
async function checkConnection(_accountId: string, state: AccountState): Promise<boolean> {
  try {
    // 尝试发送 NOOP 命令或检查连接状态
    await state.client.mailboxOpen('INBOX')
    return true
  } catch (err) {
    return false
  }
}

// 尝试重新连接单个账号
async function tryReconnect(accountId: string) {
  // 如果已经在重连中，跳过
  if (reconnectTimers[accountId]) return
  
  const state = accounts.get(accountId)
  if (!state) return
  
  const currentAttempts = reconnectAttempts[accountId] || 0
  if (currentAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log(`账号 ${state.email} 重连次数超过限制，停止自动重连`)
    // 通知前端连接已断开
    if (mainWindow) {
      mainWindow.webContents.send('email:connectionLost', { accountId, email: state.email, permanent: true })
    }
    return
  }
  
  reconnectAttempts[accountId] = currentAttempts + 1
  
  reconnectTimers[accountId] = setTimeout(async () => {
    try {
      // 使用已保存的连接信息或获取默认配置
      const host = state.host || getImapConfig(state.email).host
      const port = state.port || getImapConfig(state.email).port
      
      const client = new ImapFlow({
        host,
        port,
        secure: true,
        auth: { user: state.email, pass: state.password || '' },
        logger: false,
        tls: {
          rejectUnauthorized: false,
        },
      })
      
      await client.connect()
      await client.mailboxOpen('INBOX')
      const mailbox = client.mailbox
      const lastUid = mailbox && typeof mailbox.uidNext === 'number' ? Math.max(0, mailbox.uidNext - 1) : 0
      
      // 更新账号状态（保留原始凭据）
      accounts.set(accountId, { 
        client, 
        lastUid, 
        name: state.name, 
        email: state.email,
        password: state.password,
        host,
        port
      })
      
      // 重置重连计数
      reconnectAttempts[accountId] = 0
      delete reconnectTimers[accountId]
      
      console.log(`账号 ${state.email} 重连成功`)
      // 通知前端重连成功
      if (mainWindow) {
        mainWindow.webContents.send('email:reconnected', { accountId, email: state.email })
      }
    } catch (err) {
      delete reconnectTimers[accountId]
      console.error(`账号 ${state.email} 重连失败:`, err)
      // 通知前端重连失败
      if (mainWindow) {
        mainWindow.webContents.send('email:reconnectFailed', { accountId, email: state.email, attempt: reconnectAttempts[accountId] })
      }
    }
  }, RECONNECT_DELAY)
}

// 启动连接检测
function startConnectionCheck() {
  if (connectionCheckTimer) {
    clearInterval(connectionCheckTimer)
  }
  
  connectionCheckTimer = setInterval(async () => {
    for (const [accountId, state] of accounts) {
      const isConnected = await checkConnection(accountId, state)
      if (!isConnected) {
        console.log(`检测到账号 ${state.email} 连接断开，准备重连...`)
        await tryReconnect(accountId)
      }
    }
  }, CONNECTION_CHECK_INTERVAL)
}

async function stopMonitor() {
  if (monitorTimer) {
    clearInterval(monitorTimer)
    monitorTimer = null
  }
  // 停止连接检测
  if (connectionCheckTimer) {
    clearInterval(connectionCheckTimer)
    connectionCheckTimer = null
  }
  // 清除所有重连定时器
  Object.values(reconnectTimers).forEach(timer => clearTimeout(timer))
  reconnectTimers = {}
  reconnectAttempts = {}
}

async function disconnectAll() {
  stopMonitor()
  for (const accountId of Array.from(accounts.keys())) {
    await disconnectAccount(accountId)
  }
}

ipcMain.handle('email:connect', async (_, { email, password, imapHost, imapPort, accountName }) => {
  const accountId = email.trim().toLowerCase()
  if (accounts.has(accountId)) {
    return { ok: false, error: '该邮箱已添加' }
  }
  const { host: defaultHost, port: defaultPort } = getImapConfig(email)
  const host = (typeof imapHost === 'string' && imapHost.trim()) ? imapHost.trim() : defaultHost
  const port = (typeof imapPort === 'number' && imapPort > 0) ? imapPort : (defaultPort as number)
  const name = (typeof accountName === 'string' && accountName.trim()) ? accountName.trim() : email

  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
    tls: {
      // 允许自签名证书（解决 Windows 上证书验证失败）
      rejectUnauthorized: false,
    },
  })
  try {
    await client.connect()
    await client.mailboxOpen('INBOX')
    const mailbox = client.mailbox
    const lastUid = mailbox && typeof mailbox.uidNext === 'number' ? Math.max(0, mailbox.uidNext - 1) : 0
    accounts.set(accountId, { client, lastUid, name, email, host, port, password })
    return { ok: true, accountId, host, accountName: name }
  } catch (err: unknown) {
    let message = err instanceof Error ? err.message : String(err)
    if (message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
      message = `无法解析 IMAP 服务器「${host}」。若为企业邮箱或自定义域名，请填写实际 IMAP 地址。`
    }
    return { ok: false, error: message }
  }
})

ipcMain.handle('email:disconnect', async (_, accountId?: string) => {
  if (accountId) {
    await disconnectAccount(accountId)
  } else {
    await disconnectAll()
  }
  return { ok: true }
})

ipcMain.handle('email:listAccounts', () => {
  return Array.from(accounts.entries()).map(([id, s]) => ({ accountId: id, name: s.name, email: s.email }))
})

ipcMain.handle('email:startMonitor', async () => {
  if (!mainWindow || accounts.size === 0) return { ok: false, error: '请先添加至少一个邮箱' }

  async function pollOne(accountId: string, state: AccountState) {
    if (!mainWindow) return
    try {
      await state.client.mailboxOpen('INBOX')
      const mailbox = state.client.mailbox
      const currentLastUid =
        mailbox && typeof mailbox.uidNext === 'number' ? Math.max(0, mailbox.uidNext - 1) : 0

      if (currentLastUid > state.lastUid) {
        const lock = await state.client.getMailboxLock('INBOX')
        try {
          const fromUid = state.lastUid + 1
          const range = `${fromUid}:*`
          const messages = await state.client.fetchAll(range, { envelope: true, source: true }, { uid: true })
          const list: Array<{ uid: number; subject: string; from: string; date: string; text?: string }> = []
          for (const msg of messages) {
            const envelope = msg.envelope
            const subject = envelope?.subject || '(无主题)'
            const from = envelope?.from?.[0]?.address || envelope?.from?.[0]?.name || '未知'
            const date = envelope?.date ? new Date(envelope.date).toLocaleString('zh-CN') : ''
            let text = ''
            if (msg.source) {
              try {
                const parsed = await simpleParser(msg.source as Buffer)
                text = parsed.text || parsed.html?.substring(0, 500) || ''
              } catch (_) {}
            }
            list.push({ uid: msg.uid, subject, from, date, text })
          }
          state.lastUid = currentLastUid
          if (list.length) {
            mainWindow.webContents.send('email:newMails', { accountId, accountName: state.name, list })
            // 如果窗口被隐藏（最小化到托盘），显示托盘提示
            if (mainWindow && !mainWindow.isVisible()) {
              setUnreadIndicator()
            }
          }
        } finally {
          lock.release()
        }
      } else if (currentLastUid > 0) {
        state.lastUid = currentLastUid
      }
    } catch (_) {}
  }

  async function pollAll() {
    for (const [accountId, state] of accounts) {
      await pollOne(accountId, state)
    }
  }

  // 为每个账号设定“开始监控”时的 UID 基准，不拉取已有邮件
  for (const state of accounts.values()) {
    try {
      await state.client.mailboxOpen('INBOX')
      const mailbox = state.client.mailbox
      state.lastUid = mailbox && typeof mailbox.uidNext === 'number' ? Math.max(0, mailbox.uidNext - 1) : 0
    } catch (_) {}
  }
  monitorTimer = setInterval(pollAll, POLL_MS)
  
  // 启动连接检测和自动重连（30秒检测一次）
  startConnectionCheck()
  
  return { ok: true }
})

ipcMain.handle('email:stopMonitor', async () => {
  await stopMonitor()
  return { ok: true }
})

// 托盘区系统通知（评分≥6 时由前端调用）
ipcMain.handle('app:showNotification', (_, { title, body }: { title: string; body: string }) => {
  if (Notification.isSupported()) {
    const n = new Notification({ title, body })
    n.show()
  }
})

// 开机自启动：Windows/macOS 用系统 API，Linux 写 ~/.config/autostart
const AUTOSTART_NAME = 'ideal-list'
function getLinuxAutostartPath() {
  return join(app.getPath('home'), '.config', 'autostart', `${AUTOSTART_NAME}.desktop`)
}

function getOpenAtLogin(): boolean {
  if (process.platform === 'linux') {
    return existsSync(getLinuxAutostartPath())
  }
  return app.getLoginItemSettings().openAtLogin
}

function setOpenAtLogin(open: boolean) {
  if (process.platform === 'linux') {
    const p = getLinuxAutostartPath()
    if (open) {
      const exe = process.execPath
      mkdirSync(join(app.getPath('home'), '.config', 'autostart'), { recursive: true })
      writeFileSync(
        p,
        `[Desktop Entry]
Type=Application
Name=邮箱监控
Exec=${exe}
X-GNOME-Autostart-enabled=true
`,
        'utf8'
      )
    } else {
      if (existsSync(p)) unlinkSync(p)
    }
    return
  }
  app.setLoginItemSettings({ openAtLogin: open })
}

ipcMain.handle('app:getOpenAtLogin', () => getOpenAtLogin())
ipcMain.handle('app:setOpenAtLogin', (_, open: boolean) => setOpenAtLogin(open))

// 打开外部链接
ipcMain.handle('app:openExternal', (_, url: string) => {
  shell.openExternal(url)
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  disconnectAll()
  if (!tray) app.quit()
})

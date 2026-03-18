<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import type { MailItem, AccountInfo } from './env.d'
import deepseekService from './services/deepseek'

const STORAGE_KEY = 'ideal-list-email-draft'

interface EmailDraft {
  accountName?: string
  email?: string
  password?: string
  imapHost?: string
  imapPort?: number
}

function loadEmailDraft(): EmailDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as EmailDraft
    return d && typeof d === 'object' ? d : null
  } catch {
    return null
  }
}

function saveEmailDraft(draft: EmailDraft) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // ignore
  }
}

const accountName = ref('')
const email = ref('')
const password = ref('')
const imapHost = ref('')
const imapPort = ref<number | ''>(993)

const accounts = ref<AccountInfo[]>([])
const addStatus = ref<'idle' | 'connecting' | 'error'>('idle')
const addStatusText = ref('')
const monitorStatus = ref<'idle' | 'monitoring'>('idle')
const mails = ref<MailItem[]>([])
const selectedMail = ref<MailItem | null>(null)

/** 是否开启 AI 自动分析邮件并评分 */
const autoAnalyzeEnabled = ref(false)
/** 是否开机自启动 */
const openAtLogin = ref(false)
/** 每封邮件的 AI 分析结果：key 为 mailKey，value 为 { summary, score, loading } */
const aiResultMap = ref<Record<string, { summary: string; score: string; loading: boolean }>>({})

const api = window.electronAPI
if (!api) {
  addStatus.value = 'error'
  addStatusText.value = '当前不在桌面应用环境中'
}

function onNewMails(payload: { accountId: string; accountName: string; list: Array<{ uid: number; subject: string; from: string; date: string; text?: string }> }) {
  const { accountId, accountName: name, list } = payload
  const items: MailItem[] = list.map((m) => ({ ...m, accountId, accountName: name }))
  mails.value = [...items, ...mails.value]
  if (autoAnalyzeEnabled.value && items.length) {
    const first = items[0]
    analyzeOneMail({ ...first, accountId, accountName: name })
  }
}

onMounted(async () => {
  api?.onNewMails(onNewMails)
  const list = await api?.listAccounts?.() ?? []
  accounts.value = list
  const draft = loadEmailDraft()
  if (draft) {
    if (draft.accountName != null) accountName.value = draft.accountName
    if (draft.email != null) email.value = draft.email
    if (draft.password != null) password.value = draft.password
    if (draft.imapHost != null) imapHost.value = draft.imapHost
    if (draft.imapPort != null) imapPort.value = draft.imapPort === 0 ? '' : draft.imapPort
  }
  if (api?.getOpenAtLogin) {
    try {
      openAtLogin.value = await api.getOpenAtLogin()
    } catch (_) {}
  }
})

watch([accountName, email, password, imapHost, imapPort], () => {
  saveEmailDraft({
    accountName: accountName.value || undefined,
    email: email.value || undefined,
    password: password.value || undefined,
    imapHost: imapHost.value || undefined,
    imapPort: imapPort.value === '' ? undefined : Number(imapPort.value) || undefined,
  })
}, { deep: true })

onUnmounted(() => {
  api?.stopMonitor()
})

async function addAccount() {
  if (!api) return
  addStatus.value = 'connecting'
  addStatusText.value = '正在连接…'
  const portNum = imapPort.value === '' ? undefined : Number(imapPort.value)
  const port = (typeof portNum === 'number' && !isNaN(portNum) && portNum > 0) ? portNum : undefined
  const res = await api.connect(
    email.value.trim(),
    password.value,
    imapHost.value.trim() || undefined,
    port,
    accountName.value.trim() || undefined
  )
  if (res.ok && res.accountId) {
    addStatus.value = 'idle'
    addStatusText.value = ''
    accounts.value.push({ accountId: res.accountId, name: res.accountName ?? res.accountId, email: email.value.trim() })
    saveEmailDraft({
      accountName: accountName.value.trim() || undefined,
      email: email.value.trim() || undefined,
      password: password.value || undefined,
      imapHost: imapHost.value.trim() || undefined,
      imapPort: portNum != null && !isNaN(portNum) ? portNum : undefined,
    })
  } else {
    addStatus.value = 'error'
    addStatusText.value = res.error ?? '连接失败'
  }
}

async function removeAccount(accountId: string) {
  await api?.disconnect(accountId)
  accounts.value = accounts.value.filter((a) => a.accountId !== accountId)
  mails.value = mails.value.filter((m) => m.accountId !== accountId)
  if (selectedMail.value?.accountId === accountId) selectedMail.value = null
}

async function disconnectAll() {
  await api?.disconnect()
  accounts.value = []
  mails.value = []
  selectedMail.value = null
  monitorStatus.value = 'idle'
  addStatusText.value = ''
}

async function startMonitor() {
  if (!api) return
  const res = await api.startMonitor()
  if (res.ok) {
    monitorStatus.value = 'monitoring'
    addStatusText.value = '正在监控所有已添加邮箱，新邮件将显示在下方列表'
  } else {
    addStatus.value = 'error'
    addStatusText.value = res.error ?? '启动监控失败'
  }
}

function stopMonitor() {
  api?.stopMonitor()
  monitorStatus.value = 'idle'
  addStatusText.value = accounts.value.length ? '已暂停监控' : ''
}

function mailKey(m: MailItem) {
  return `${m.accountId}-${m.uid}`
}

const AI_PROMPT = `你是一个邮件分析助手。请对以下邮件进行简要分析，并严格按以下格式回复（不要省略标题）：
【评分】x/10
（1-10 分，表示重要性/意向强度，10 为最高）
【总结】一两句话概括邮件要点。
【建议】简短跟进建议（可选）。`

async function analyzeOneMail(mail: MailItem) {
  const key = mailKey(mail)
  if (aiResultMap.value[key]?.loading) return
  aiResultMap.value = {
    ...aiResultMap.value,
    [key]: {
      summary: aiResultMap.value[key]?.summary ?? '',
      score: aiResultMap.value[key]?.score ?? '',
      loading: true,
    },
  }
  const content = `主题：${mail.subject}\n发件人：${mail.from}\n日期：${mail.date}\n\n正文：\n${mail.text ?? '(无正文)'}`
  const messages = [
    { role: 'user' as const, content: AI_PROMPT },
    { role: 'user' as const, content },
  ]
  try {
    let full = ''
    await deepseekService.sendMessage(messages, (chunk) => {
      full += chunk
      aiResultMap.value = {
        ...aiResultMap.value,
        [key]: {
          ...aiResultMap.value[key],
          summary: full,
          loading: true,
        },
      }
    })
    const scoreMatch = full.match(/【评分】\s*(\d+(?:\.\d+)?)\s*\/\s*10/)
    const score = scoreMatch ? `${scoreMatch[1]}/10` : ''
    const scoreNum = scoreMatch ? parseFloat(scoreMatch[1]) : 0
    aiResultMap.value = {
      ...aiResultMap.value,
      [key]: { summary: full, score, loading: false },
    }
    if (scoreNum >= 6 && api?.showNotification) {
      api.showNotification({
        title: '邮件评分提醒',
        body: `${mail.subject} 评分 ${score}`,
      }).catch(() => {})
    }
  } catch (e) {
    aiResultMap.value = {
      ...aiResultMap.value,
      [key]: {
        summary: `分析失败：${e instanceof Error ? e.message : String(e)}`,
        score: '',
        loading: false,
      },
    }
  }
}

watch(selectedMail, (mail) => {
  if (!autoAnalyzeEnabled.value || !mail) return
  const key = mailKey(mail)
  if (!aiResultMap.value[key]) {
    analyzeOneMail(mail)
  }
}, { immediate: true })

async function onOpenAtLoginChange() {
  try {
    await api?.setOpenAtLogin?.(openAtLogin.value)
  } catch (_) {}
}

function toggleAutoAnalyze() {
  autoAnalyzeEnabled.value = !autoAnalyzeEnabled.value
  if (autoAnalyzeEnabled.value && selectedMail.value) {
    const key = mailKey(selectedMail.value)
    if (!aiResultMap.value[key]?.summary && !aiResultMap.value[key]?.loading) {
      analyzeOneMail(selectedMail.value)
    }
  }
}
</script>

<template>
  <div class="app">
    <header class="header">
      <h1>邮箱实时监控</h1>
      <p class="hint">添加多个邮箱并设置自定义名称，统一监控新邮件</p>
      <label v-if="api" class="open-at-login">
        <input type="checkbox" v-model="openAtLogin" @change="onOpenAtLoginChange" />
        <span>开机自启动</span>
      </label>
    </header>

    <section class="add-form" v-if="monitorStatus !== 'monitoring'">
      <h2 class="sec-title">添加邮箱</h2>
      <div class="row">
        <label>显示名称（选填）</label>
        <input v-model="accountName" type="text" placeholder="例如：wyxd的腾讯企业邮" :disabled="addStatus === 'connecting'" />
      </div>
      <div class="row">
        <label>邮箱</label>
        <input v-model="email" type="email" placeholder="your@company.com" :disabled="addStatus === 'connecting'" />
      </div>
      <div class="row">
        <label>客户端密码</label>
        <input v-model="password" type="password" placeholder="应用专用密码 / 授权码" :disabled="addStatus === 'connecting'" />
      </div>
      <div class="row">
        <label>IMAP 服务器（选填）</label>
        <input v-model="imapHost" type="text" placeholder="企业邮箱请填实际地址" :disabled="addStatus === 'connecting'" />
      </div>
      <div class="row">
        <label>IMAP 端口（选填）</label>
        <input v-model.number="imapPort" type="number" placeholder="993" min="1" max="65535" :disabled="addStatus === 'connecting'" />
      </div>
      <div class="actions">
        <button class="btn primary" @click="addAccount" :disabled="!email.trim() || !password || addStatus === 'connecting'">添加并连接</button>
      </div>
      <p v-if="addStatus === 'error'" class="err-msg">{{ addStatusText }}</p>
    </section>

    <section class="accounts" v-if="accounts.length">
      <h2 class="sec-title">已添加的邮箱</h2>
      <ul class="account-list">
        <li v-for="a in accounts" :key="a.accountId" class="account-item">
          <span class="account-name">{{ a.name }}</span>
          <span class="account-email">{{ a.email }}</span>
          <button class="btn small" @click="removeAccount(a.accountId)">移除</button>
        </li>
      </ul>
      <div class="monitor-actions">
        <button v-if="monitorStatus === 'idle'" class="btn primary" @click="startMonitor">开始监控全部</button>
        <button v-else class="btn" @click="stopMonitor">暂停监控</button>
        <button class="btn" @click="disconnectAll">全部断开</button>
        <button
          class="btn"
          :class="{ primary: autoAnalyzeEnabled }"
          @click="toggleAutoAnalyze"
          :title="autoAnalyzeEnabled ? '关闭后新邮件与选中邮件将不再自动调用 AI 分析' : '开启后将对选中邮件及新邮件自动进行 AI 分析并评分'"
        >
          {{ autoAnalyzeEnabled ? '自动分析：已开启' : '自动分析：关闭' }}
        </button>
      </div>
      <p v-if="addStatusText && addStatus !== 'error'" class="status-msg">{{ addStatusText }}</p>
    </section>

    <section v-if="!api" class="status error-hint">
      <span class="dot error" />
      <span class="error-block">
        当前不在桌面应用环境中。请用 <code>npm run dev</code> 启动后，在自动弹出的 Electron 窗口中操作。
      </span>
    </section>

    <section class="mail-area" v-if="monitorStatus === 'monitoring' || mails.length">
      <div class="mail-list">
        <h2>收件列表</h2>
        <ul>
          <li
            v-for="m in mails"
            :key="mailKey(m)"
            :class="{ active: selectedMail && mailKey(selectedMail) === mailKey(m) }"
            @click="selectedMail = m"
          >
            <span class="tag" :title="m.accountName">{{ m.accountName }}</span>
            <span v-if="aiResultMap[mailKey(m)]?.score" class="score-badge" :title="'AI 评分 ' + aiResultMap[mailKey(m)].score">{{ aiResultMap[mailKey(m)].score }}</span>
            <span class="from">{{ m.from }}</span>
            <span class="subject">{{ m.subject }}</span>
            <span class="date">{{ m.date }}</span>
          </li>
        </ul>
      </div>
      <div class="mail-detail" v-if="selectedMail">
        <h3>{{ selectedMail.subject }}</h3>
        <div class="meta">
          <span class="detail-tag">{{ selectedMail.accountName }}</span>
          发件人：{{ selectedMail.from }} · {{ selectedMail.date }}
        </div>
        <div v-if="autoAnalyzeEnabled && (aiResultMap[mailKey(selectedMail)]?.summary || aiResultMap[mailKey(selectedMail)]?.loading)" class="ai-section">
          <h4>AI 分析</h4>
          <div v-if="aiResultMap[mailKey(selectedMail)].loading && !aiResultMap[mailKey(selectedMail)].summary" class="ai-loading">正在分析…</div>
          <div v-else class="ai-content">
            <pre class="ai-text">{{ aiResultMap[mailKey(selectedMail)].summary }}</pre>
            <p v-if="aiResultMap[mailKey(selectedMail)].score" class="ai-score">评分：{{ aiResultMap[mailKey(selectedMail)].score }}</p>
          </div>
        </div>
        <pre class="body">{{ selectedMail.text || '(无正文)' }}</pre>
      </div>
    </section>
  </div>
</template>

<style scoped>
.app {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
  font-family: 'Segoe UI', system-ui, sans-serif;
}
.header {
  margin-bottom: 24px;
}
.header h1 {
  font-size: 1.5rem;
  font-weight: 600;
  color: #1a1a2e;
  margin: 0 0 8px 0;
}
.hint {
  color: #64748b;
  font-size: 0.9rem;
  margin: 0;
}
.open-at-login {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 0.9rem;
  color: #475569;
  cursor: pointer;
}
.open-at-login input {
  width: auto;
  max-width: none;
}
.sec-title {
  font-size: 1rem;
  margin: 0 0 12px 0;
  color: #1e293b;
}
.row {
  margin-bottom: 12px;
}
.row label {
  display: block;
  font-size: 0.85rem;
  color: #475569;
  margin-bottom: 4px;
}
.row input {
  width: 100%;
  max-width: 360px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 1rem;
}
.row input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}
.actions,
.monitor-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  flex-wrap: wrap;
}
.btn {
  padding: 10px 18px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #fff;
  cursor: pointer;
  font-size: 0.95rem;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn.primary {
  background: #3b82f6;
  color: #fff;
  border-color: #3b82f6;
}
.btn.small {
  padding: 6px 12px;
  font-size: 0.85rem;
}
.err-msg,
.status-msg {
  margin-top: 12px;
  color: #dc2626;
  font-size: 0.9rem;
}
.status-msg {
  color: #475569;
}
.account-list {
  list-style: none;
  padding: 0;
  margin: 0 0 16px 0;
}
.account-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: #f8fafc;
  border-radius: 8px;
  margin-bottom: 8px;
}
.account-name {
  font-weight: 500;
  color: #1e293b;
  min-width: 140px;
}
.account-email {
  font-size: 0.9rem;
  color: #64748b;
  flex: 1;
}
.status.error-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #fef2f2;
  border-radius: 8px;
  margin-bottom: 20px;
  font-size: 0.9rem;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot.error {
  background: #ef4444;
}
.error-block code {
  background: #e2e8f0;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}
.mail-area {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 20px;
  min-height: 360px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
}
.mail-list,
.mail-detail {
  padding: 16px;
  overflow: auto;
}
.mail-list {
  background: #f8fafc;
  border-right: 1px solid #e2e8f0;
}
.mail-list h2,
.mail-detail h3 {
  font-size: 1rem;
  margin: 0 0 12px 0;
  color: #1e293b;
}
.mail-list ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.mail-list li {
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 4px;
  border: 1px solid transparent;
}
.mail-list li:hover {
  background: #f1f5f9;
}
.mail-list li.active {
  background: #e0f2fe;
  border-color: #7dd3fc;
}
.mail-list .tag {
  display: inline-block;
  font-size: 0.7rem;
  padding: 2px 6px;
  border-radius: 4px;
  background: #e0e7ff;
  color: #3730a3;
  margin-bottom: 4px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mail-list .from {
  display: block;
  font-size: 0.85rem;
  color: #64748b;
  margin-bottom: 4px;
}
.mail-list .subject {
  font-weight: 500;
  color: #1e293b;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mail-list .date {
  font-size: 0.75rem;
  color: #94a3b8;
  display: block;
  margin-top: 4px;
}
.mail-detail .meta {
  font-size: 0.85rem;
  color: #64748b;
  margin-bottom: 12px;
}
.mail-detail .detail-tag {
  display: inline-block;
  margin-right: 8px;
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 4px;
  background: #e0e7ff;
  color: #3730a3;
}
.mail-detail .body {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.9rem;
  line-height: 1.5;
  margin: 0;
  color: #334155;
}
.score-badge {
  display: inline-block;
  font-size: 0.7rem;
  padding: 2px 6px;
  border-radius: 4px;
  background: #dbeafe;
  color: #1d4ed8;
  margin-left: 6px;
  font-weight: 600;
}
.ai-section {
  margin-bottom: 16px;
  padding: 12px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
}
.ai-section h4 {
  margin: 0 0 8px 0;
  font-size: 0.9rem;
  color: #166534;
}
.ai-loading {
  color: #15803d;
  font-size: 0.9rem;
}
.ai-content .ai-text {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.85rem;
  line-height: 1.5;
  margin: 0 0 8px 0;
  color: #334155;
}
.ai-score {
  margin: 0;
  font-weight: 600;
  color: #166534;
  font-size: 0.9rem;
}
</style>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import type { MailItem, AccountInfo } from './env.d'
import deepseekService from './services/deepseek'

const STORAGE_KEY = 'ideal-list-email-draft'
const MAIL_HISTORY_KEY = 'ideal-list-mail-history'
const AI_RESULTS_KEY = 'ideal-list-ai-results'
const PROMPT_TEMPLATES_KEY = 'ideal-list-prompt-templates'
const CURRENT_PROMPT_KEY = 'ideal-list-current-prompt'
const ACCOUNTS_STORAGE_KEY = 'ideal-list-accounts'

interface EmailDraft {
  accountName?: string
  email?: string
  password?: string
  imapHost?: string
  imapPort?: number
}

// 用于持久化的账户信息（不含密码，密码从 draft 中读取）
interface SavedAccount {
  accountId: string
  name: string
  email: string
  host?: string
  port?: number
}

interface PromptTemplate {
  id: string
  name: string
  content: string
  createdAt: number
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

// 保存账户列表到本地存储
function saveAccountsToStorage(accountList: AccountInfo[]) {
  try {
    const toSave: SavedAccount[] = accountList.map(acc => ({
      accountId: acc.accountId,
      name: acc.name,
      email: acc.email,
    }))
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(toSave))
  } catch {
    // ignore
  }
}

// 从本地存储加载账户列表
function loadAccountsFromStorage(): SavedAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as SavedAccount[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

// 加载邮件历史
function loadMailHistory(): MailItem[] {
  try {
    const raw = localStorage.getItem(MAIL_HISTORY_KEY)
    if (!raw) return []
    const mails = JSON.parse(raw) as MailItem[]
    return Array.isArray(mails) ? mails : []
  } catch {
    return []
  }
}

// 保存邮件历史
function saveMailHistory(mails: MailItem[]) {
  try {
    // 只保存最近 100 封邮件，避免 localStorage 溢出
    const toSave = mails.slice(0, 100)
    localStorage.setItem(MAIL_HISTORY_KEY, JSON.stringify(toSave))
  } catch {
    // ignore
  }
}

// 加载 AI 分析结果
function loadAiResults(): Record<string, { summary: string; score: string; loading: boolean }> {
  try {
    const raw = localStorage.getItem(AI_RESULTS_KEY)
    if (!raw) return {}
    const results = JSON.parse(raw) as Record<string, { summary: string; score: string; loading: boolean }>
    return typeof results === 'object' ? results : {}
  } catch {
    return {}
  }
}

// 保存 AI 分析结果
function saveAiResults(results: Record<string, { summary: string; score: string; loading: boolean }>) {
  try {
    // 过滤掉 loading 状态的结果，不保存
    const toSave: Record<string, { summary: string; score: string; loading: boolean }> = {}
    for (const [key, value] of Object.entries(results)) {
      if (!value.loading) {
        toSave[key] = value
      }
    }
    localStorage.setItem(AI_RESULTS_KEY, JSON.stringify(toSave))
  } catch {
    // ignore
  }
}

// 加载提示词模板
function loadPromptTemplates(): PromptTemplate[] {
  try {
    const raw = localStorage.getItem(PROMPT_TEMPLATES_KEY)
    if (!raw) return getDefaultPromptTemplates()
    const templates = JSON.parse(raw) as PromptTemplate[]
    return Array.isArray(templates) && templates.length > 0 ? templates : getDefaultPromptTemplates()
  } catch {
    return getDefaultPromptTemplates()
  }
}

// 保存提示词模板
function savePromptTemplates(templates: PromptTemplate[]) {
  try {
    localStorage.setItem(PROMPT_TEMPLATES_KEY, JSON.stringify(templates))
  } catch {
    // ignore
  }
}

// 加载当前提示词
function loadCurrentPrompt(): string {
  try {
    const raw = localStorage.getItem(CURRENT_PROMPT_KEY)
    return raw || getDefaultPrompt()
  } catch {
    return getDefaultPrompt()
  }
}

// 保存当前提示词
function saveCurrentPrompt(prompt: string) {
  try {
    localStorage.setItem(CURRENT_PROMPT_KEY, prompt)
  } catch {
    // ignore
  }
}

// 默认提示词
function getDefaultPrompt(): string {
  return `你是一个邮件分析助手。请对以下邮件进行简要分析，并严格按以下格式回复（不要省略标题）：
【评分】x/10
（1-10 分，表示重要性/意向强度，10 为最高）
【总结】一两句话概括邮件要点。
【建议】简短跟进建议（可选）。`
}

// 默认提示词模板
function getDefaultPromptTemplates(): PromptTemplate[] {
  return [
    {
      id: 'default',
      name: '默认模板',
      content: getDefaultPrompt(),
      createdAt: Date.now()
    },
    {
      id: 'sales',
      name: '销售分析',
      content: `你是一个销售邮件分析专家。请分析以下邮件，判断客户意向度：
【评分】x/10
（10分表示成交意向极高，1分表示无兴趣）
【客户意向】描述客户的购买意向和关注点
【下一步行动】给出具体的跟进建议
【回复要点】建议回复时应包含的关键信息`,
      createdAt: Date.now()
    },
    {
      id: 'support',
      name: '客服支持',
      content: `你是一个客服支持分析助手。请分析以下客户邮件：
【评分】x/10
（10分表示紧急重要，1分表示一般咨询）
【问题类型】技术问题/账单问题/功能咨询/投诉建议/其他
【客户情绪】愤怒/着急/平静/满意
【处理建议】具体的处理步骤和回复要点`,
      createdAt: Date.now()
    }
  ]
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

/** 是否显示历史记录 */
const showHistory = ref(false)
/** 提示词模板 */
const promptTemplates = ref<PromptTemplate[]>(loadPromptTemplates())
/** 当前使用的提示词 */
const currentPrompt = ref(loadCurrentPrompt())
/** 是否显示提示词编辑器 */
const showPromptEditor = ref(false)
/** 编辑中的提示词名称 */
const editingPromptName = ref('')
/** 编辑中的提示词内容 */
const editingPromptContent = ref('')
/** 是否编辑已有模板 */
const editingPromptId = ref<string | null>(null)

const api = window.electronAPI
if (!api) {
  addStatus.value = 'error'
  addStatusText.value = '当前不在桌面应用环境中'
}

function onNewMails(payload: { accountId: string; accountName: string; list: Array<{ uid: number; subject: string; from: string; date: string; text?: string }> }) {
  const { accountId, accountName: name, list } = payload
  const items: MailItem[] = list.map((m) => ({ ...m, accountId, accountName: name }))
  mails.value = [...items, ...mails.value]
  // 保存到本地
  saveMailHistory(mails.value)
  if (autoAnalyzeEnabled.value && items.length) {
    const first = items[0]
    analyzeOneMail({ ...first, accountId, accountName: name })
  }
}

onMounted(async () => {
  api?.onNewMails(onNewMails)

  // 先从本地存储加载账户信息
  const savedAccounts = loadAccountsFromStorage()
  const draft = loadEmailDraft()

  // 尝试自动重新连接之前保存的账户
  if (savedAccounts.length > 0 && draft?.password && api) {
    addStatusText.value = '正在恢复之前的邮箱连接...'
    for (const saved of savedAccounts) {
      try {
        // 使用保存的信息重新连接
        const portNum = draft.imapPort
        const port = (typeof portNum === 'number' && !isNaN(portNum) && portNum > 0) ? portNum : undefined
        const res = await api.connect(
          saved.email,
          draft.password,
          draft.imapHost || undefined,
          port,
          saved.name
        )
        if (res.ok && res.accountId) {
          accounts.value.push({
            accountId: res.accountId,
            name: res.accountName ?? saved.name,
            email: saved.email
          })
        }
      } catch (e) {
        console.error('重新连接账户失败:', saved.email, e)
      }
    }
    if (accounts.value.length > 0) {
      addStatusText.value = `已恢复 ${accounts.value.length} 个邮箱连接`
    } else {
      addStatusText.value = '之前的邮箱连接已失效，请重新添加'
    }
  }

  // 加载表单草稿
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

// 监听 AI 结果变化并保存
watch(aiResultMap, (newValue) => {
  saveAiResults(newValue)
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
    addStatusText.value = '邮箱添加成功！'
    accounts.value.push({ accountId: res.accountId, name: res.accountName ?? res.accountId, email: email.value.trim() })
    // 保存账户列表到本地存储
    saveAccountsToStorage(accounts.value)
    // 清除表单
    accountName.value = ''
    email.value = ''
    password.value = ''
    imapHost.value = ''
    imapPort.value = 993
    // 清除保存的草稿
    saveEmailDraft({})
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
  saveMailHistory(mails.value)
  // 保存账户列表到本地存储
  saveAccountsToStorage(accounts.value)
}

async function disconnectAll() {
  await api?.disconnect()
  accounts.value = []
  mails.value = []
  selectedMail.value = null
  monitorStatus.value = 'idle'
  addStatusText.value = ''
  saveMailHistory([])
  // 清除本地存储的账户列表
  try {
    localStorage.removeItem(ACCOUNTS_STORAGE_KEY)
  } catch {
    // ignore
  }
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
    { role: 'user' as const, content: currentPrompt.value },
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

// 加载历史记录
function loadHistory() {
  const historyMails = loadMailHistory()
  const historyResults = loadAiResults()
  if (historyMails.length > 0) {
    mails.value = historyMails
    aiResultMap.value = historyResults
    showHistory.value = true
  }
}

// 清空历史记录
function clearHistory() {
  mails.value = []
  aiResultMap.value = {}
  saveMailHistory([])
  saveAiResults({})
  showHistory.value = false
}

// 打开提示词编辑器
function openPromptEditor(template?: PromptTemplate) {
  if (template) {
    editingPromptId.value = template.id
    editingPromptName.value = template.name
    editingPromptContent.value = template.content
  } else {
    editingPromptId.value = null
    editingPromptName.value = ''
    editingPromptContent.value = currentPrompt.value
  }
  showPromptEditor.value = true
}

// 保存提示词模板
function savePromptTemplate() {
  if (!editingPromptName.value.trim()) {
    alert('请输入提示词名称')
    return
  }
  if (!editingPromptContent.value.trim()) {
    alert('请输入提示词内容')
    return
  }

  if (editingPromptId.value) {
    // 更新现有模板
    const index = promptTemplates.value.findIndex(p => p.id === editingPromptId.value)
    if (index >= 0) {
      promptTemplates.value[index] = {
        ...promptTemplates.value[index],
        name: editingPromptName.value.trim(),
        content: editingPromptContent.value.trim(),
      }
    }
  } else {
    // 创建新模板
    const newTemplate: PromptTemplate = {
      id: 'prompt_' + Date.now(),
      name: editingPromptName.value.trim(),
      content: editingPromptContent.value.trim(),
      createdAt: Date.now(),
    }
    promptTemplates.value.push(newTemplate)
  }

  savePromptTemplates(promptTemplates.value)
  showPromptEditor.value = false
  editingPromptId.value = null
  editingPromptName.value = ''
  editingPromptContent.value = ''
}

// 选择提示词模板
function selectPromptTemplate(template: PromptTemplate) {
  currentPrompt.value = template.content
  saveCurrentPrompt(template.content)
}

// 删除提示词模板
function deletePromptTemplate(id: string) {
  if (confirm('确定要删除这个提示词模板吗？')) {
    promptTemplates.value = promptTemplates.value.filter(p => p.id !== id)
    savePromptTemplates(promptTemplates.value)
  }
}

// 应用当前编辑的提示词
function applyCurrentPrompt() {
  currentPrompt.value = editingPromptContent.value
  saveCurrentPrompt(editingPromptContent.value)
  showPromptEditor.value = false
}

// 打开官网
function openWebsite() {
  const websiteUrl = 'https://emailTool.ycplanet.com/'
  if (api?.openExternal) {
    api.openExternal(websiteUrl)
  } else {
    window.open(websiteUrl, '_blank')
  }
}
</script>

<template>
  <div class="app">
    <!-- 科技背景效果 -->
    <div class="tech-bg">
      <div class="grid-overlay"></div>
      <div class="glow-orb orb-1"></div>
      <div class="glow-orb orb-2"></div>
    </div>

    <header class="header">
      <div class="header-title">
        <div class="logo-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
          </svg>
        </div>
        <div class="title-text">
          <h1>邮箱实时监控</h1>
          <p class="hint">AI 驱动的智能邮件分析系统</p>
        </div>
        <div class="status-indicator" :class="{ active: monitorStatus === 'monitoring' }">
          <span class="status-dot"></span>
          <span class="status-text">{{ monitorStatus === 'monitoring' ? '监控中' : '待机' }}</span>
        </div>
      </div>
      <div class="header-actions">
        <label v-if="api" class="tech-toggle">
          <input type="checkbox" v-model="openAtLogin" @change="onOpenAtLoginChange" />
          <span class="toggle-slider"></span>
          <span class="toggle-label">开机自启</span>
        </label>
        <button class="btn small" @click="openWebsite">
          <span class="btn-icon">🌐</span> 官网
        </button>
        <button class="btn small" :class="{ 'ai-active': showHistory }" @click="showHistory = !showHistory">
          <span class="btn-icon">📋</span> {{ showHistory ? '隐藏历史' : '历史记录' }}
        </button>
        <button class="btn primary" @click="openPromptEditor()">
          <span class="btn-icon">⚙️</span> 提示词设置
        </button>
      </div>
    </header>

    <!-- 历史记录面板 -->
    <section v-if="showHistory" class="history-panel tech-card">
      <div class="card-header">
        <div class="card-title">
          <span class="title-icon">📋</span>
          <h2>历史记录</h2>
        </div>
        <span class="count-badge">{{ mails.length }} 封邮件</span>
      </div>
      <p class="hint">已缓存邮件及 AI 分析结果</p>
      <div class="actions">
        <button class="btn" @click="loadHistory">
          <span class="btn-icon">📂</span> 加载历史
        </button>
        <button class="btn danger" @click="clearHistory">
          <span class="btn-icon">🗑️</span> 清空历史
        </button>
        <button class="btn" @click="showHistory = false">
          <span class="btn-icon">✕</span> 关闭
        </button>
      </div>
    </section>

    <!-- 提示词编辑器 -->
    <section v-if="showPromptEditor" class="prompt-editor tech-card">
      <div class="card-header">
        <div class="card-title">
          <span class="title-icon">⚙️</span>
          <h2>AI 提示词配置</h2>
        </div>
      </div>

      <div class="prompt-templates">
        <h3 class="subsection-title">
          <span class="btn-icon">📋</span> 选择模板
        </h3>
        <div class="template-list">
          <div
            v-for="template in promptTemplates"
            :key="template.id"
            class="template-item tech-card-mini"
            :class="{ active: currentPrompt === template.content }"
            @click="selectPromptTemplate(template)"
          >
            <div class="template-info">
              <span class="template-name">{{ template.name }}</span>
              <span v-if="currentPrompt === template.content" class="active-badge">当前使用</span>
            </div>
            <div class="template-actions">
              <button class="btn small" @click.stop="openPromptEditor(template)">编辑</button>
              <button v-if="!['default', 'sales', 'support'].includes(template.id)" class="btn small danger" @click.stop="deletePromptTemplate(template.id)">删除</button>
            </div>
          </div>
        </div>
      </div>

      <div class="tech-card-mini" style="margin-bottom: 16px;">
        <h3 class="subsection-title">
          <span class="btn-icon">✏️</span> {{ editingPromptId ? '编辑提示词' : '新建提示词' }}
        </h3>
        <div class="row">
          <label>提示词名称</label>
          <input v-model="editingPromptName" type="text" placeholder="例如：销售分析模板" class="tech-input" />
        </div>
        <div class="row">
          <label>提示词内容</label>
          <textarea v-model="editingPromptContent" rows="6" placeholder="请输入 AI 分析提示词..." class="tech-textarea" />
        </div>
        <div class="actions">
          <button class="btn primary" @click="savePromptTemplate">
            <span class="btn-icon">💾</span> 保存模板
          </button>
          <button class="btn" @click="applyCurrentPrompt">
            <span class="btn-icon">✓</span> 直接应用
          </button>
          <button class="btn" @click="showPromptEditor = false">
            <span class="btn-icon">✕</span> 取消
          </button>
        </div>
      </div>

      <div class="tech-card-mini">
        <h3 class="subsection-title">
          <span class="btn-icon">👁️</span> 当前使用的提示词
        </h3>
        <pre class="prompt-preview">{{ currentPrompt }}</pre>
      </div>
    </section>

    <section class="add-form tech-card" v-if="monitorStatus !== 'monitoring'">
      <div class="card-header">
        <div class="card-title">
          <span class="title-icon">➕</span>
          <h2>添加邮箱账户</h2>
        </div>
      </div>
      <div class="form-grid">
        <div class="row">
          <label>
            <span class="label-icon">🏷️</span> 显示名称
            <span class="optional">选填</span>
          </label>
          <input v-model="accountName" type="text" placeholder="例如：wyxd的腾讯企业邮" :disabled="addStatus === 'connecting'" class="tech-input" />
        </div>
        <div class="row">
          <label>
            <span class="label-icon">📧</span> 邮箱地址
          </label>
          <input v-model="email" type="email" placeholder="your@company.com" :disabled="addStatus === 'connecting'" class="tech-input" />
        </div>
        <div class="row">
          <label>
            <span class="label-icon">🔐</span> 客户端密码
          </label>
          <input v-model="password" type="password" placeholder="应用专用密码 / 授权码" :disabled="addStatus === 'connecting'" class="tech-input" />
        </div>
        <div class="row">
          <label>
            <span class="label-icon">🌐</span> IMAP 服务器
            <span class="optional">选填</span>
          </label>
          <input v-model="imapHost" type="text" placeholder="企业邮箱请填实际地址" :disabled="addStatus === 'connecting'" class="tech-input" />
        </div>
        <div class="row">
          <label>
            <span class="label-icon">🔢</span> IMAP 端口
            <span class="optional">选填</span>
          </label>
          <input v-model.number="imapPort" type="number" placeholder="993" min="1" max="65535" :disabled="addStatus === 'connecting'" class="tech-input" />
        </div>
      </div>
      <div class="actions">
        <button class="btn primary" @click="addAccount" :disabled="!email.trim() || !password || addStatus === 'connecting'">
          <span class="btn-icon">🔗</span>
          {{ addStatus === 'connecting' ? '连接中...' : '添加并连接' }}
        </button>
      </div>
      <p v-if="addStatus === 'error'" class="err-msg">{{ addStatusText }}</p>
    </section>

    <section class="accounts tech-card" v-if="accounts.length">
      <div class="card-header">
        <div class="card-title">
          <span class="title-icon">📬</span>
          <h2>已添加的邮箱</h2>
        </div>
        <span class="count-badge">{{ accounts.length }} 个账户</span>
      </div>
      <ul class="account-list">
        <li v-for="a in accounts" :key="a.accountId" class="account-item tech-card-mini">
          <div class="account-info">
            <div class="account-avatar">
              {{ a.name.charAt(0).toUpperCase() }}
            </div>
            <div class="account-details">
              <span class="account-name">{{ a.name }}</span>
              <span class="account-email">{{ a.email }}</span>
            </div>
          </div>
          <button class="btn small danger" @click="removeAccount(a.accountId)" title="移除账户">
            ✕
          </button>
        </li>
      </ul>
      <div class="monitor-actions">
        <button v-if="monitorStatus === 'idle'" class="btn success" @click="startMonitor">
          <span class="btn-icon">▶</span> 开始监控
        </button>
        <button v-else class="btn warning" @click="stopMonitor">
          <span class="btn-icon">⏸</span> 暂停监控
        </button>
        <button class="btn" @click="disconnectAll">
          <span class="btn-icon">⏹</span> 全部断开
        </button>
        <button
          class="btn"
          :class="{ 'ai-active': autoAnalyzeEnabled }"
          @click="toggleAutoAnalyze"
          :title="autoAnalyzeEnabled ? '关闭后新邮件与选中邮件将不再自动调用 AI 分析' : '开启后将对选中邮件及新邮件自动进行 AI 分析并评分'"
        >
          <span class="btn-icon">🤖</span>
          {{ autoAnalyzeEnabled ? 'AI 分析：开启' : 'AI 分析：关闭' }}
        </button>
      </div>
      <p v-if="addStatusText && addStatus !== 'error'" class="status-msg">{{ addStatusText }}</p>
    </section>

    <section v-if="!api" class="error-hint tech-card error">
      <div class="error-icon">⚠️</div>
      <div class="error-content">
        <span class="error-title">环境错误</span>
        <span class="error-block">
          当前不在桌面应用环境中。请用 <code>npm run dev</code> 启动后，在自动弹出的 Electron 窗口中操作。
        </span>
      </div>
    </section>

    <section class="mail-area" v-if="monitorStatus === 'monitoring' || mails.length">
      <div class="mail-list">
        <h2>
          <span class="btn-icon">📨</span>
          收件列表
          <span class="count-badge" style="margin-left: 8px;">{{ mails.length }}</span>
        </h2>
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
          <span style="color: var(--text-secondary);">发件人：{{ selectedMail.from }} · {{ selectedMail.date }}</span>
        </div>
        <div v-if="autoAnalyzeEnabled && (aiResultMap[mailKey(selectedMail)]?.summary || aiResultMap[mailKey(selectedMail)]?.loading)" class="ai-section">
          <div class="ai-header">
            <span class="ai-icon">🤖</span>
            <h4>AI 智能分析</h4>
            <div v-if="aiResultMap[mailKey(selectedMail)].loading" class="ai-loading-dots">
              <span></span><span></span><span></span>
            </div>
          </div>
          <div v-if="aiResultMap[mailKey(selectedMail)].loading && !aiResultMap[mailKey(selectedMail)].summary" class="ai-loading-text" style="color: var(--text-secondary);">
            正在分析邮件内容...
          </div>
          <div v-else class="ai-content">
            <pre class="ai-text">{{ aiResultMap[mailKey(selectedMail)].summary }}</pre>
            <p v-if="aiResultMap[mailKey(selectedMail)].score" class="ai-score">
              <span class="score-label">综合评分</span>
              <span class="score-value">{{ aiResultMap[mailKey(selectedMail)].score }}</span>
            </p>
          </div>
        </div>
        <pre class="body">{{ selectedMail.text || '(无正文)' }}</pre>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ===== 基础布局 ===== */
.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
  position: relative;
  z-index: 1;
}

/* ===== 科技背景效果 - 纯色版 ===== */
.tech-bg {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: -1;
  overflow: hidden;
  background: var(--tech-bg-primary);
}

.grid-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image:
    repeating-linear-gradient(0deg, rgba(0, 212, 212, 0.05) 0px, rgba(0, 212, 212, 0.05) 1px, transparent 1px, transparent 60px),
    repeating-linear-gradient(90deg, rgba(0, 212, 212, 0.05) 0px, rgba(0, 212, 212, 0.05) 1px, transparent 1px, transparent 60px);
}

.glow-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.1;
}

.orb-1 {
  width: 400px;
  height: 400px;
  background: var(--tech-cyan);
  top: -150px;
  right: -100px;
}

.orb-2 {
  width: 300px;
  height: 300px;
  background: var(--tech-purple);
  bottom: -100px;
  left: -50px;
}

/* ===== 头部样式 ===== */
.header {
  margin-bottom: 24px;
  padding: 24px;
  background: var(--tech-bg-card);
  border: 1px solid var(--border-secondary);
  border-radius: 12px;
  box-shadow: var(--shadow-md);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.logo-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tech-cyan);
  border-radius: 10px;
  color: var(--tech-bg-primary);
  flex-shrink: 0;
}

.logo-icon svg {
  width: 24px;
  height: 24px;
}

.title-text h1 {
  font-size: 1.6rem;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary);
  letter-spacing: -0.5px;
}

.hint {
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin: 4px 0 0 0;
}

.status-indicator {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: var(--tech-bg-secondary);
  border: 1px solid var(--border-secondary);
  border-radius: 20px;
}

.status-indicator.active {
  border-color: var(--tech-green);
  background: rgba(16, 185, 129, 0.1);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}

.status-indicator.active .status-dot {
  background: var(--tech-green);
  box-shadow: 0 0 8px var(--tech-green);
}

.status-text {
  font-size: 0.85rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.header-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

/* ===== 按钮样式 ===== */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: 8px;
  border: 1px solid var(--border-secondary);
  background: var(--tech-bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn:hover:not(:disabled) {
  border-color: var(--border-primary);
  background: var(--tech-bg-input);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-icon {
  font-size: 1rem;
}

.btn.primary {
  background: var(--tech-cyan);
  border-color: var(--tech-cyan);
  color: var(--tech-bg-primary);
  font-weight: 600;
}

.btn.primary:hover:not(:disabled) {
  background: var(--tech-cyan-bright);
  box-shadow: var(--shadow-glow);
}

.btn.success {
  background: rgba(16, 185, 129, 0.2);
  border-color: var(--tech-green);
  color: var(--tech-green);
}

.btn.warning {
  background: rgba(245, 158, 11, 0.2);
  border-color: var(--tech-orange);
  color: var(--tech-orange);
}

.btn.danger {
  background: rgba(239, 68, 68, 0.1);
  border-color: var(--tech-red);
  color: var(--tech-red);
}

.btn.ai-active {
  background: var(--tech-cyan-dim);
  border-color: var(--tech-cyan);
  color: var(--tech-cyan);
}

.btn.small {
  padding: 6px 12px;
  font-size: 0.85rem;
}

/* ===== 开关样式 ===== */
.tech-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.tech-toggle input {
  display: none;
}

.toggle-slider {
  width: 44px;
  height: 24px;
  background: var(--tech-bg-input);
  border: 1px solid var(--border-secondary);
  border-radius: 12px;
  position: relative;
  transition: all 0.3s ease;
}

.toggle-slider::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: var(--text-muted);
  border-radius: 50%;
  transition: all 0.3s ease;
}

.tech-toggle input:checked + .toggle-slider {
  background: var(--tech-cyan-dim);
  border-color: var(--tech-cyan);
}

.tech-toggle input:checked + .toggle-slider::after {
  left: 22px;
  background: var(--tech-cyan);
}

.toggle-label {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

/* ===== 卡片样式 ===== */
.tech-card {
  background: var(--tech-bg-card);
  border: 1px solid var(--border-secondary);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
  box-shadow: var(--shadow-md);
}

.tech-card-mini {
  background: var(--tech-bg-secondary);
  border: 1px solid var(--border-secondary);
  border-radius: 8px;
  padding: 12px;
  transition: all 0.2s ease;
}

.tech-card-mini:hover {
  border-color: var(--border-primary);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.card-title h2 {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}

.title-icon {
  font-size: 1.2rem;
}

.count-badge {
  padding: 4px 10px;
  background: var(--tech-bg-input);
  border: 1px solid var(--border-secondary);
  border-radius: 12px;
  font-size: 0.8rem;
  color: var(--tech-cyan);
}

/* ===== 表单样式 ===== */
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.row {
  margin-bottom: 12px;
}

.row label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.label-icon {
  font-size: 0.9rem;
}

.optional {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--text-muted);
  background: var(--tech-bg-input);
  padding: 2px 8px;
  border-radius: 4px;
}

.tech-input {
  width: 100%;
  padding: 12px 14px;
  background: var(--tech-bg-input);
  border: 1px solid var(--border-secondary);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 0.95rem;
  transition: all 0.2s ease;
}

.tech-input::placeholder {
  color: var(--text-muted);
}

.tech-input:focus {
  outline: none;
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px rgba(0, 212, 212, 0.1);
}

.tech-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.err-msg {
  margin-top: 12px;
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  color: var(--tech-red);
  font-size: 0.9rem;
}

.status-msg {
  margin-top: 12px;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

/* ===== 历史记录面板 ===== */
.history-panel .hint {
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin-bottom: 16px;
}

/* ===== 提示词编辑器 ===== */
.subsection-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.template-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.template-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
}

.template-item.active {
  border-color: var(--tech-cyan);
  background: var(--tech-cyan-dim);
}

.template-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.template-name {
  font-weight: 500;
  color: var(--text-primary);
}

.active-badge {
  padding: 2px 8px;
  background: var(--tech-cyan-dim);
  border: 1px solid var(--tech-cyan);
  border-radius: 4px;
  font-size: 0.75rem;
  color: var(--tech-cyan);
}

.template-actions {
  display: flex;
  gap: 6px;
}

.tech-textarea {
  width: 100%;
  min-height: 120px;
  padding: 12px 14px;
  background: var(--tech-bg-input);
  border: 1px solid var(--border-secondary);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 0.9rem;
  font-family: 'Fira Code', monospace;
  resize: vertical;
  line-height: 1.6;
}

.tech-textarea:focus {
  outline: none;
  border-color: var(--border-focus);
}

.prompt-preview {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.85rem;
  line-height: 1.6;
  margin: 0;
  color: var(--text-secondary);
  background: var(--tech-bg-input);
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--border-secondary);
  max-height: 200px;
  overflow-y: auto;
  font-family: 'Fira Code', monospace;
}

/* ===== 账户列表 ===== */
.account-list {
  list-style: none;
  padding: 0;
  margin: 0 0 16px 0;
}

.account-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.account-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.account-avatar {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tech-cyan);
  border-radius: 8px;
  font-weight: 600;
  color: var(--tech-bg-primary);
  font-size: 1rem;
}

.account-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.account-name {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 0.95rem;
}

.account-email {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.monitor-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

/* ===== 错误提示 ===== */
.error-hint {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 20px;
}

.error-hint.error {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
}

.error-icon {
  font-size: 1.4rem;
  flex-shrink: 0;
}

.error-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.error-title {
  font-weight: 600;
  color: var(--tech-red);
}

.error-block {
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.error-block code {
  background: var(--tech-bg-input);
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--tech-cyan);
  font-family: 'Fira Code', monospace;
}

/* ===== 邮件区域 ===== */
.mail-area {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 0;
  min-height: 480px;
  background: var(--tech-bg-card);
  border: 1px solid var(--border-secondary);
  border-radius: 12px;
  overflow: hidden;
}

.mail-list {
  background: var(--tech-bg-secondary);
  border-right: 1px solid var(--border-secondary);
  padding: 16px;
  overflow-y: auto;
}

.mail-list h2 {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 12px 0;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
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
  margin-bottom: 6px;
  border: 1px solid transparent;
  background: var(--tech-bg-input);
  transition: all 0.2s ease;
}

.mail-list li:hover {
  border-color: var(--border-primary);
  background: rgba(0, 212, 212, 0.05);
}

.mail-list li.active {
  background: var(--tech-cyan-dim);
  border-color: var(--tech-cyan);
}

.mail-list .tag {
  display: inline-block;
  font-size: 0.7rem;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--tech-purple);
  color: var(--text-primary);
  margin-right: 6px;
}

.score-badge {
  display: inline-block;
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--tech-cyan);
  color: var(--tech-bg-primary);
  font-weight: 700;
}

.mail-list .from {
  display: block;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-top: 6px;
}

.mail-list .subject {
  font-weight: 500;
  color: var(--text-primary);
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 4px;
}

.mail-list .date {
  font-size: 0.75rem;
  color: var(--text-muted);
  display: block;
  margin-top: 4px;
}

.mail-detail {
  padding: 20px;
  overflow-y: auto;
}

.mail-detail h3 {
  font-size: 1.2rem;
  font-weight: 600;
  margin: 0 0 12px 0;
  color: var(--text-primary);
  line-height: 1.4;
}

.mail-detail .meta {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-bottom: 16px;
}

.detail-tag {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--tech-purple);
  color: var(--text-primary);
  font-size: 0.8rem;
  font-weight: 500;
  margin-right: 8px;
}

/* ===== AI 分析区域 ===== */
.ai-section {
  position: relative;
  background: var(--tech-bg-secondary);
  border: 1px solid var(--border-secondary);
  border-top: 2px solid var(--tech-cyan);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.ai-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.ai-icon {
  font-size: 1.2rem;
}

.ai-section h4 {
  margin: 0;
  font-size: 0.95rem;
  color: var(--tech-cyan);
  font-weight: 600;
}

.ai-loading-dots {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.ai-loading-dots span {
  width: 6px;
  height: 6px;
  background: var(--tech-cyan);
  border-radius: 50%;
  animation: bounce 1.4s ease-in-out infinite both;
}

.ai-loading-dots span:nth-child(1) { animation-delay: -0.32s; }
.ai-loading-dots span:nth-child(2) { animation-delay: -0.16s; }

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

.ai-text {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.9rem;
  line-height: 1.7;
  margin: 0 0 12px 0;
  color: var(--text-secondary);
  font-family: inherit;
}

.ai-score {
  margin: 0;
  padding-top: 12px;
  border-top: 1px solid var(--border-secondary);
  display: flex;
  align-items: center;
  gap: 10px;
}

.ai-score .score-label {
  font-size: 0.85rem;
  color: var(--text-muted);
}

.ai-score .score-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--tech-cyan);
}

.mail-detail .body {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.9rem;
  line-height: 1.7;
  margin: 0;
  color: var(--text-secondary);
  background: var(--tech-bg-input);
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--border-secondary);
}

/* ===== 响应式 ===== */
@media (max-width: 900px) {
  .mail-area {
    grid-template-columns: 1fr;
    grid-template-rows: 300px 1fr;
  }
  .mail-list {
    border-right: none;
    border-bottom: 1px solid var(--border-secondary);
  }
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>

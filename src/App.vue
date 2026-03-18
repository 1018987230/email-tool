<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import type { MailItem, AccountInfo } from './env.d'
import deepseekService from './services/deepseek'

const STORAGE_KEY = 'ideal-list-email-draft'
const MAIL_HISTORY_KEY = 'ideal-list-mail-history'
const AI_RESULTS_KEY = 'ideal-list-ai-results'
const PROMPT_TEMPLATES_KEY = 'ideal-list-prompt-templates'
const CURRENT_PROMPT_KEY = 'ideal-list-current-prompt'

interface EmailDraft {
  accountName?: string
  email?: string
  password?: string
  imapHost?: string
  imapPort?: number
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
  saveMailHistory(mails.value)
}

async function disconnectAll() {
  await api?.disconnect()
  accounts.value = []
  mails.value = []
  selectedMail.value = null
  monitorStatus.value = 'idle'
  addStatusText.value = ''
  saveMailHistory([])
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
</script>

<template>
  <div class="app">
    <header class="header">
      <h1>邮箱实时监控</h1>
      <p class="hint">添加多个邮箱并设置自定义名称，统一监控新邮件</p>
      <div class="header-actions">
        <label v-if="api" class="open-at-login">
          <input type="checkbox" v-model="openAtLogin" @change="onOpenAtLoginChange" />
          <span>开机自启动</span>
        </label>
        <button class="btn small" @click="showHistory = !showHistory">
          {{ showHistory ? '隐藏历史' : '历史记录' }}
        </button>
        <button class="btn small" @click="openPromptEditor()">
          提示词设置
        </button>
      </div>
    </header>

    <!-- 历史记录面板 -->
    <section v-if="showHistory" class="history-panel">
      <h2 class="sec-title">历史记录</h2>
      <p class="hint">已缓存 {{ mails.length }} 封邮件及 AI 分析结果</p>
      <div class="actions">
        <button class="btn" @click="loadHistory">加载历史记录</button>
        <button class="btn" @click="clearHistory">清空历史</button>
        <button class="btn" @click="showHistory = false">关闭</button>
      </div>
    </section>

    <!-- 提示词编辑器 -->
    <section v-if="showPromptEditor" class="prompt-editor">
      <h2 class="sec-title">提示词设置</h2>
      
      <div class="prompt-templates">
        <h3>选择模板</h3>
        <div class="template-list">
          <div 
            v-for="template in promptTemplates" 
            :key="template.id"
            class="template-item"
            :class="{ active: currentPrompt === template.content }"
            @click="selectPromptTemplate(template)"
          >
            <span class="template-name">{{ template.name }}</span>
            <div class="template-actions">
              <button class="btn tiny" @click.stop="openPromptEditor(template)">编辑</button>
              <button v-if="!['default', 'sales', 'support'].includes(template.id)" class="btn tiny danger" @click.stop="deletePromptTemplate(template.id)">删除</button>
            </div>
          </div>
        </div>
      </div>

      <div class="prompt-edit-form">
        <h3>{{ editingPromptId ? '编辑提示词' : '新建提示词' }}</h3>
        <div class="row">
          <label>提示词名称</label>
          <input v-model="editingPromptName" type="text" placeholder="例如：销售分析模板" />
        </div>
        <div class="row">
          <label>提示词内容</label>
          <textarea v-model="editingPromptContent" rows="8" placeholder="请输入 AI 分析提示词..." />
        </div>
        <div class="actions">
          <button class="btn primary" @click="savePromptTemplate">保存模板</button>
          <button class="btn" @click="applyCurrentPrompt">直接应用</button>
          <button class="btn" @click="showPromptEditor = false">取消</button>
        </div>
      </div>

      <div class="current-prompt-preview">
        <h3>当前使用的提示词</h3>
        <pre class="prompt-preview">{{ currentPrompt }}</pre>
      </div>
    </section>

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
        <h2>收件列表（{{ mails.length }} 封）</h2>
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
.header-actions {
  display: flex;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
  align-items: center;
}
.open-at-login {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  color: #475569;
  cursor: pointer;
}
.open-at-login input {
  width: auto;
  max-width: none;
}

/* 历史记录面板 */
.history-panel {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 20px;
}

/* 提示词编辑器 */
.prompt-editor {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 20px;
}
.prompt-editor h3 {
  font-size: 0.95rem;
  margin: 16px 0 12px 0;
  color: #1e293b;
}
.prompt-editor h3:first-child {
  margin-top: 0;
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
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}
.template-item:hover {
  border-color: #3b82f6;
}
.template-item.active {
  border-color: #3b82f6;
  background: #eff6ff;
}
.template-name {
  font-weight: 500;
  color: #1e293b;
}
.template-actions {
  display: flex;
  gap: 6px;
}
.prompt-edit-form {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}
.prompt-edit-form textarea {
  width: 100%;
  min-height: 120px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.9rem;
  font-family: monospace;
  resize: vertical;
}
.prompt-edit-form textarea:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}
.current-prompt-preview {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px;
}
.prompt-preview {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.85rem;
  line-height: 1.5;
  margin: 0;
  color: #334155;
  background: #f1f5f9;
  padding: 12px;
  border-radius: 6px;
  max-height: 200px;
  overflow-y: auto;
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
.btn.tiny {
  padding: 4px 8px;
  font-size: 0.75rem;
}
.btn.danger {
  color: #dc2626;
  border-color: #dc2626;
}
.btn.danger:hover {
  background: #fef2f2;
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

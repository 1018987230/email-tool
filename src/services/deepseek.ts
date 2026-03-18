/**
 * DeepSeek 对话 API 服务（流式）
 * API Key 建议通过环境变量 VITE_DEEPSEEK_API_KEY 配置
 */
const DEEPSEEK_API_KEY =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_DEEPSEEK_API_KEY) ||
  'sk-6ea87233885c481cab80223fd0e2a1ab'
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

let controller: AbortController | null = null

export const deepseekService = {
  abort() {
    if (controller) {
      controller.abort()
      controller = null
    }
  },

  async sendMessage(
    messages: Array<{ role: string; content: string }>,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    controller = new AbortController()
    const signal = controller.signal
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        stream: true,
      }),
      signal,
    })

    const reader = response.body!.getReader()
    const decoder = new TextDecoder('utf-8')
    let result = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n')
      for (const line of lines) {
        if (line.startsWith('data:')) {
          const dataStr = line.replace(/^data:\s*/, '')
          if (dataStr === '[DONE]') return result
          try {
            const json = JSON.parse(dataStr)
            const content = json.choices?.[0]?.delta?.content
            if (content) {
              result += content
              onChunk(content)
            }
          } catch {
            // 忽略解析片段错误
          }
        }
      }
    }
    return result
  },
}

export default deepseekService

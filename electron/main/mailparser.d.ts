declare module 'mailparser' {
  import { Readable } from 'stream'
  export function simpleParser(
    source: Buffer | Readable | string,
    options?: unknown
  ): Promise<{ text?: string; html?: string; [key: string]: unknown }>
}

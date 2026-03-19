import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, existsSync } from 'fs'

// 复制 preload 脚本的插件 - 在构建开始前复制
const copyPreload = () => ({
  name: 'copy-preload',
  buildStart() {
    // 确保目录存在并复制文件
    mkdirSync('dist-electron/preload', { recursive: true })
    copyFileSync('electron/preload/index.cjs', 'dist-electron/preload/index.js')
    console.log('Preload script copied successfully')
  },
})

export default defineConfig({
  plugins: [
    vue(),
    // 先复制 preload 文件
    copyPreload(),
    // 只构建主进程，不构建 preload（因为 preload 已经复制好了）
    electron({
      entry: 'electron/main/index.ts',
      onstart: (options) => {
        if (options.startup) {
          options.startup()
        }
      },
      vite: {
        build: {
          outDir: 'dist-electron/main',
          rollupOptions: {
            external: ['electron', 'imapflow', 'mailparser'],
          },
        },
      },
    }),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  // 确保清空目录时不会删除 preload
  build: {
    emptyOutDir: false,
  },
})
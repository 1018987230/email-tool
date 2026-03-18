#!/usr/bin/env node
// 禁用 SSL 证书验证，避免 unable to verify the first certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
process.env.npm_config_strict_ssl = 'false'

import { execSync } from 'child_process'

const env = { 
  ...process.env, 
  NODE_TLS_REJECT_UNAUTHORIZED: '0',
  npm_config_strict_ssl: 'false',
  ELECTRON_GET_USE_PROXY: '1'
}

const run = (cmd) => execSync(cmd, { stdio: 'inherit', shell: true, env })

run('vue-tsc --noEmit')
run('vite build')
run('npm run copy-preload')
run('electron-builder --win')

import { defineConfig } from '@playwright/test'
import { createRequire } from 'node:module'

const keys = createRequire(import.meta.url)('web-push').generateVAPIDKeys()
const url = 'http://127.0.0.1:4173'
const api = 'http://127.0.0.1:4174'
const env = {
  NIGHTWATCH_CONTROL_CODE: 'playwright-control-code',
  NVIDIA_API_KEY: '',
  NIGHTWATCH_API_ORIGIN: '',
  NIGHTWATCH_PUBLIC_ORIGIN: '',
  VAPID_PUBLIC_KEY: keys.publicKey,
  VAPID_PRIVATE_KEY: keys.privateKey,
  VAPID_SUBJECT: 'mailto:field@example.test',
  NIGHTWATCH_WORKFLOW_FILE: 'test-results/workflow-' + Date.now() + '.json',
  NIGHTWATCH_RECORDINGS_DIR: 'test-results/recordings-' + Date.now(),
}
const vite = 'node node_modules/vite/bin/vite.js'
const flags = ' --host 127.0.0.1 --port 4173 --strictPort'
const split = process.env.NIGHTWATCH_TEST_SPLIT === '1'

export default defineConfig({
  testDir: './browser-tests',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: url,
    channel: process.env.NIGHTWATCH_BROWSER ?? 'chrome',
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: split ? [
    { command: 'node server/main.ts', url: api + '/api/health/ready', timeout: 30000, env: { ...env, NIGHTWATCH_API_PORT: '4174' } },
    { command: vite + ' preview' + flags, url, timeout: 30000, env: { ...env, NIGHTWATCH_API_ORIGIN: api } },
  ] : { command: vite + flags, url, timeout: 30000, env },
})

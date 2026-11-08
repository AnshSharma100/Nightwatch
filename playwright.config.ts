import { defineConfig } from '@playwright/test'

const url = 'http://127.0.0.1:4173'
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
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort', url, timeout: 30000 },
})

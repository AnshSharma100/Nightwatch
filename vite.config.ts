import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import { createWorkspace } from './server/workspace.ts'

function localWorkspace(env: Record<string, string>): Plugin {
  return {
    name: 'nightwatch-local-api',
    configureServer(server) {
      const workspace = createWorkspace(env)
      server.middlewares.use((req, res, next) => { void workspace.handle(req, res, next) })
      server.httpServer?.once('close', () => { void workspace.close() })
      void workspace.recover()
    },
    configurePreviewServer(server) {
      const workspace = createWorkspace(env)
      server.middlewares.use((req, res, next) => { void workspace.handle(req, res, next) })
      server.httpServer.once('close', () => { void workspace.close() })
      void workspace.recover()
    },
  }
}

function verifyClientBoundary(): Plugin {
  const serverModules = /\/(?:packages\/domain\/(?:load|incidents|simulate|optimize|operations)|src\/agent\/investigate)\.ts$/
  return {
    name: 'nightwatch-client-boundary',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && output.moduleIds.some((id) => serverModules.test(id.replaceAll('\\', '/')))) {
          this.error('An authoritative operational module entered the browser bundle.')
        }
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['NVIDIA_', 'NIGHTWATCH_', 'VAPID_', 'DATABASE_URL'])
  const publicHost = env.NIGHTWATCH_PUBLIC_ORIGIN ? new URL(env.NIGHTWATCH_PUBLIC_ORIGIN).hostname : undefined
  const proxy = env.NIGHTWATCH_API_ORIGIN ? { '/api': { target: env.NIGHTWATCH_API_ORIGIN } } : undefined
  return {
    plugins: [verifyClientBoundary(), ...(proxy ? [] : [localWorkspace(env)])],
    server: { proxy, fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.nightwatch/**', '**/test-results/**'] } },
    preview: { proxy, allowedHosts: publicHost ? [publicHost] : undefined },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] },
        },
      },
    },
  }
})

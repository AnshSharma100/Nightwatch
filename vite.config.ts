import { defineConfig, loadEnv } from 'vite'
import { workspaceApi } from './server/workspace.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['NVIDIA_', 'NIGHTWATCH_', 'VAPID_'])
  const publicHost = env.NIGHTWATCH_PUBLIC_ORIGIN ? new URL(env.NIGHTWATCH_PUBLIC_ORIGIN).hostname : undefined
  return {
    plugins: [workspaceApi(env)],
    server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.nightwatch/**', '**/test-results/**'] } },
    preview: { allowedHosts: publicHost ? [publicHost] : undefined },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] },
        },
      },
    },
  }
})

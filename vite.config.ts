import { defineConfig, loadEnv } from 'vite'
import { nemotronBridge } from './server/nemotron.ts'
import { workspaceApi } from './server/workspace.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'NVIDIA_')
  return {
    plugins: [workspaceApi(), nemotronBridge(env.NVIDIA_API_KEY, env.NVIDIA_MODEL)],
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] },
        },
      },
    },
  }
})

import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, projectRoot, ''), ...process.env }
  const host = !env.HOST || env.HOST === '0.0.0.0' || env.HOST === '::' ? '127.0.0.1' : env.HOST
  const proxyHost = host.includes(':') ? `[${host}]` : host
  return {
    envDir: projectRoot,
    plugins: [react()],
    server: {
      port: Number(env.FRONTEND_PORT || 5173),
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://${proxyHost}:${env.PORT || 3001}`,
          changeOrigin: true,
        },
      },
    },
  }
})

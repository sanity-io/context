import react from '@vitejs/plugin-react'
import {config} from 'dotenv'
import {defineConfig} from 'vite'

config()

const SERVER_PORT = Number(process.env.PORT) || 58400

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      // Forward chat requests to the local agent server
      '/api': {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
      },
    },
  },
})

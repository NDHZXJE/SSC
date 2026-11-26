import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Khi phát triển: `npm run dev`, API chạy ở cổng 8000
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8000' } },
})

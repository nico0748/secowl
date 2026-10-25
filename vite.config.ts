import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 文字列で書くと changeOrigin: true になり、Host が 127.0.0.1:5174 に書き換わります。
    // サーバは書き込みの Origin（127.0.0.1:5173）と Host の一致を確かめるため、Host を変えずに転送します。
    proxy: { '/api': { target: 'http://127.0.0.1:5174', changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})

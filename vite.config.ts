import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// No GitHub Pages o site fica em /one-map/; localmente continua na raiz.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/one-map/' : '/',
  plugins: [react()],
})

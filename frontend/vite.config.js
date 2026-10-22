import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc' // Use SWC plugin for better performance and TypeScript support
import tailwindcss from '@tailwindcss/vite'

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src')

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // `@/…` always means `src/…`, so imports don't change when a file moves deeper.
    alias: { '@': srcDir },
  },
  server: {
    strictPort: false,
    hmr: { overlay: false },
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/.vite/**',
        '**/coverage/**',
      ],
    },
  },
})

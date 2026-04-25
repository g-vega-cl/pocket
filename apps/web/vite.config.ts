import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import netlify from '@netlify/vite-plugin-tanstack-start'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  server: {
    allowedHosts: ['bolt.clvg.uk'],
    hmr: {
      host: 'bolt.clvg.uk',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5173',
        changeOrigin: true,
      },
      '/ws': {
        target: 'http://localhost:5173',
        ws: true,
      },
    },
  },
  plugins: [
    devtools(),
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart(),
    netlify(),
    viteReact({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
  ],
})

export default config

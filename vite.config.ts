import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/hexagonal-chess/',
  test: {
    environment: 'node',
    typecheck: { tsconfig: './tsconfig.test.json' },
  },
})

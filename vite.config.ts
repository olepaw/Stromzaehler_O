import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules') && /recharts|d3-|victory|decimal|react-smooth/.test(id)) return 'charts';
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
});

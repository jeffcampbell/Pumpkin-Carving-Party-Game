import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 800, // three.js is most of the bundle
  },
});

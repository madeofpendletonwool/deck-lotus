import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // The format rules live in ../shared so the server can use them too
    fs: { allow: ['..'] },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['./src/services/api.js'],
        },
      },
    },
  },
});

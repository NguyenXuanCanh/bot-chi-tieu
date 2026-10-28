import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Khi dev: API chạy ở Worker (wrangler dev, cổng 8787).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/admin/api': 'http://localhost:8787' } },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = 'http://localhost:4000'; // the Express server

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/socket.io': { target, ws: true },
    },
  },
});

import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

// Stamped into the bundle so the running app can say which build it is. Without
// this there was no way to tell a stale installed PWA from a current one — the
// question "why does my phone look different to the website?" was unanswerable
// from inside the app.
function buildStamp(): string {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    return `${date} ${sha}`;
  } catch {
    return date;
  }
}
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(buildStamp()) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Fitness Training Buddy',
        short_name: 'FitBuddy',
        description: 'Personal training tracker — log workouts fast, own your history.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});

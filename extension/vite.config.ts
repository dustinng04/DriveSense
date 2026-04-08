import { defineConfig, loadEnv, type Plugin } from 'vite';
import { resolve } from 'path';
import { copyFileSync, cpSync, existsSync } from 'fs';

/**
 * Multi-entry Vite build for the DriveSense Chrome MV3 extension.
 *
 * Shared modules (e.g. api.ts) are extracted to dist/assets/ by Rollup.
 * This is fine for popup and background (both load via <script src="..."> or
 * import()). For the content script, the shared code is inlined since it
 * imports from the same bundle closure.
 *
 * The manifest lists background.js, content.js, and popup.html.
 * The popup.html loads popup.js which in turn imports the shared chunk via ESM.
 */
function copyStaticPlugin(): Plugin {
  return {
    name: 'copy-extension-statics',
    writeBundle() {
      console.log('Copying extension static files...');
      // Copy manifest
      copyFileSync(
        resolve(__dirname, 'manifest.json'),
        resolve(__dirname, 'dist/manifest.json'),
      );
      // Copy popup HTML (Vite doesn't process it as an entry automatically)
      copyFileSync(
        resolve(__dirname, 'src/popup/index.html'),
        resolve(__dirname, 'dist/popup.html'),
      );
      // Copy icons
      const iconsSrc = resolve(__dirname, 'icons');
      const iconsDist = resolve(__dirname, 'dist/icons');
      if (existsSync(iconsSrc)) {
        cpSync(iconsSrc, iconsDist, { recursive: true });
        console.log(`Successfully copied icons to ${iconsDist}`);
      } else {
        console.warn(`Warning: Source icons directory not found at ${iconsSrc}`);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const API_URL = (env.API_URL ?? env.VITE_API_URL ?? 'http://localhost:3001').replace(
    /\/$/,
    '',
  );
  const VITE_DASHBOARD_URL = (env.VITE_DASHBOARD_URL ?? 'http://localhost:5173').replace(
    /\/$/,
    '',
  );
  const VITE_API_BEARER_TOKEN = env.VITE_API_BEARER_TOKEN ?? '';

  return {
  plugins: [copyStaticPlugin()],
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(API_URL),
    'import.meta.env.VITE_DASHBOARD_URL': JSON.stringify(VITE_DASHBOARD_URL),
    'import.meta.env.VITE_API_BEARER_TOKEN': JSON.stringify(VITE_API_BEARER_TOKEN),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    minify: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        content:    resolve(__dirname, 'src/content/index.ts'),
        popup:      resolve(__dirname, 'src/popup/index.ts'),
      },
      output: {
        format: 'es',
        dir: 'dist',
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  };
});


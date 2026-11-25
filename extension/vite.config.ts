import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { buildSync } from 'esbuild';
import { resolve } from 'path';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';

const browserTarget = process.env.BROWSER_TARGET || 'chrome';
const buildVariant = process.env.BUILD_VARIANT === 'debug' ? 'debug' : 'production';
const enableUserInputImageExport = process.env.ENABLE_USER_INPUT_IMAGE_EXPORT !== 'false';
const isDebugBuild = buildVariant === 'debug';
const outDir = isDebugBuild ? `dist/${browserTarget}-debug` : `dist/${browserTarget}`;

function copyManifest(): Plugin {
  return {
    name: 'copy-manifest',
    writeBundle(options) {
      const manifest = JSON.parse(readFileSync(resolve(__dirname, 'manifest.json'), 'utf-8'));

      // Adjust paths: source manifest references src/ paths, but built output uses bundled files
      manifest.action.default_popup = 'src/popup/index.html';
      manifest.options_ui.page = 'src/options/index.html';

      let manifestToWrite = manifest;

      if (browserTarget === 'firefox') {
        // Firefox can load a classic script reliably; that script then imports the ESM bundle.
        manifest.background = {
          scripts: ['background-loader.js'],
        };
        // Firefox does not support manifest.oauth2 and reports it as unexpected.
        const { oauth2: _unusedOauth2, ...firefoxManifest } = manifest as Record<string, unknown>;
        manifestToWrite = firefoxManifest;
        // Keep popup UX on Firefox: toolbar click should open the existing popup panel.
        const firefoxAction = (manifestToWrite.action ?? {}) as Record<string, unknown>;
        manifestToWrite.action = {
          ...firefoxAction,
          default_popup: 'src/popup/index.html',
        };
        // Firefox MV3 uses browser_specific_settings
        manifestToWrite.browser_specific_settings = {
          gecko: {
            ...(manifestToWrite.browser_specific_settings?.gecko as Record<string, unknown> | undefined),
            id: 'gemini_chat_exporter@iplaysoft.com',
            strict_min_version: '109.0',
            data_collection_permissions: {
              required: ['none'],
            },
          },
        };
      } else {
        manifest.background = {
          service_worker: 'background.js',
          type: 'module',
        };
      }

      manifest.content_scripts[0].js = [browserTarget === 'firefox' ? 'content-loader.js' : 'content.js'];

      // Allow content script to dynamically import chunks (e.g. html2pdf)
      manifestToWrite.web_accessible_resources = [
        {
          resources: ['assets/*', 'content.js', 'pdf-renderer.html'],
          matches: ['https://gemini.google.com/*'],
        },
      ];

      const outDir = options.dir || resolve(__dirname, `dist/${browserTarget}`);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifestToWrite, null, 2));

      // Copy html2pdf UMD bundle for content script to load via <script> tag
      const assetsDir = resolve(outDir, 'assets');
      mkdirSync(assetsDir, { recursive: true });
      copyFileSync(
        resolve(__dirname, 'node_modules/html2pdf.js/dist/html2pdf.bundle.min.js'),
        resolve(assetsDir, 'html2pdf-bundle.js'),
      );
    },
    closeBundle() {
      if (browserTarget !== 'firefox') {
        buildSync({
          entryPoints: [resolve(__dirname, 'src/content/index.ts')],
          bundle: true,
          format: 'iife',
          target: 'es2020',
          minify: !isDebugBuild,
          sourcemap: isDebugBuild,
          outfile: resolve(__dirname, outDir, 'content.js'),
          alias: { '@': resolve(__dirname, 'src') },
          define: {
            __BROWSER_TARGET__: JSON.stringify(browserTarget),
            __BUILD_VARIANT__: JSON.stringify(buildVariant),
            __ENABLE_USER_INPUT_IMAGE_EXPORT__: JSON.stringify(enableUserInputImageExport),
          },
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copyManifest()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
    minify: isDebugBuild ? false : 'esbuild',
    sourcemap: isDebugBuild,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        ...(browserTarget === 'firefox' ? { content: resolve(__dirname, 'src/content/index.ts') } : {}),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background.js';
          if (chunkInfo.name === 'content') return 'content.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  define: {
    __BROWSER_TARGET__: JSON.stringify(browserTarget),
    __BUILD_VARIANT__: JSON.stringify(buildVariant),
    __ENABLE_USER_INPUT_IMAGE_EXPORT__: JSON.stringify(enableUserInputImageExport),
  },
});

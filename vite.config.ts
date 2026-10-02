import { defineConfig } from 'vite';

/** Production/dev bundler configuration. */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    minify: 'oxc',
    rollupOptions: {
      output: {
        entryFileNames: 'bundle.js',
        assetFileNames: (asset: { name?: string }) => asset.name?.endsWith('.css') ? 'bundle.css' : 'assets/[name]-[hash][extname]'
      }
    }
  }
});

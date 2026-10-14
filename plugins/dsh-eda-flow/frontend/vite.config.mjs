import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({ root: directory, base: '/api/eda-flow/', plugins: [react()], build: { outDir: path.join(directory, '../client'), emptyOutDir: true, assetsInlineLimit: 100000, rollupOptions: { output: { entryFileNames: 'app.js', assetFileNames: asset => asset.names?.some(n => n.endsWith('.css')) ? 'styles.css' : '[name][extname]' } } } });

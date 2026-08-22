import { defineConfig } from 'tsdown'

/** Build only the Electron runtime bundle; TypeScript intermediates stay in lib/types. */
export default defineConfig({
  entry: ['lib/types/main.js', 'lib/types/preload.js'],
  outDir: 'lib/bundle',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  deps: { neverBundle: ['electron'] },
  fixedExtension: false,
  dts: false,
  clean: true,
})

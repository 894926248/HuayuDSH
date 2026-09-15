import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { defineConfig } from '../dsh-market/node_modules/tsdown/dist/index.mjs'
import { transform } from '../dsh-market/node_modules/lightningcss/node/index.mjs'

const id = 'dsh-model-settings'
const EXTERNALS = [
  /^@deepseek-ai\//,
  /^react(?:\/|$)/,
]
const CSS_PREFIX = '\0dsh-model-settings-css:'
const CSS_SUFFIX = '.mjs'

function isExternal(source: string): boolean {
  return EXTERNALS.some(pattern => pattern.test(source))
}

const clientConfig = {
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  external: EXTERNALS,
  noExternal: (source: string) => isExternal(source) ? undefined : true,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  plugins: [{
    name: 'dsh-model-settings-css-modules',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const absolute = importer === undefined ? source : resolvePath(dirname(importer), source)
      return CSS_PREFIX + absolute + CSS_SUFFIX
    },
    async load(this: { addWatchFile(file: string): void }, virtualId: string) {
      if (!virtualId.startsWith(CSS_PREFIX)) return null
      const file = virtualId.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
      this.addWatchFile(file)
      const source = await readFile(file)
      const result = transform({
        filename: file,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const exports: Record<string, string> = {}
      for (const [local, value] of Object.entries(result.exports ?? {})) exports[local] = value.name
      const tagId = `${id}/${basename(file)}`
      return [
        `const css = ${JSON.stringify(result.code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {',
        '  const tag = document.createElement("style");',
        `  tag.dataset.plugin = ${JSON.stringify(id)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(exports)};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapPathTransform: (source: string) => source,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

const hostConfig = {
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  external: EXTERNALS,
  noExternal: (source: string) => isExternal(source) ? undefined : true,
  outputOptions: {
    entryFileNames: 'index.js',
  },
}

export default defineConfig([hostConfig, clientConfig])

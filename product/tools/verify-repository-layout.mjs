import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const productRoot = resolve(root, 'product')
const requiredRootDirectories = ['upstream', 'product', 'plugins']
const retiredRootDirectories = ['apps', 'packages', 'docs', 'examples', 'native', 'patches', 'python', 'scripts', 'vendor', 'website', 'coverage', 'dist-exe-rc8']
const requiredProductDirectories = ['app', 'config', 'docs', 'tools']
const unexpectedProductDirectories = readdirSync(productRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && !requiredProductDirectories.includes(entry.name))
  .map(entry => entry.name)
const errors = []

for (const directory of requiredRootDirectories) {
  if (!existsSync(resolve(root, directory))) errors.push(`required root directory is missing: ${directory}`)
}
for (const directory of retiredRootDirectories) {
  if (existsSync(resolve(root, directory))) errors.push(`retired root directory is present: ${directory}`)
}
for (const directory of requiredProductDirectories) {
  if (!existsSync(resolve(productRoot, directory))) errors.push(`required product directory is missing: product/${directory}`)
}
for (const directory of unexpectedProductDirectories) errors.push(`unexpected product directory: product/${directory}`)

if (errors.length > 0) {
  for (const error of errors) console.error(`repository-layout: ${error}`)
  process.exitCode = 1
} else {
  console.log('repository-layout: PASS (upstream, product, plugins; product app, config, docs, tools)')
}

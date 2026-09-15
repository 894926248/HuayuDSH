import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readUpstreamRelease } from './upstream-release.mjs'

const root = resolve(import.meta.dirname, '../..')
const product = JSON.parse(readFileSync(resolve(root, 'product/config/product-version.json'), 'utf8'))
const upstream = readUpstreamRelease(root)

console.log(`product\t${product.version}\t${product.channel}`)
console.log(`upstream\t${upstream.version}\t${upstream.tag}\t${upstream.commit}`)

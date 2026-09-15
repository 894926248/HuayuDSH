import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

export function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function writeBuildResult({ root, resultPath, state, command, outputRoot, files }) {
  const absoluteRoot = resolve(root)
  const absoluteOutput = resolve(outputRoot)
  const entries = files.map(path => {
    const absolutePath = resolve(path)
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      throw new Error(`build-result: expected artifact is missing: ${absolutePath}`)
    }
    return {
      path: relative(absoluteRoot, absolutePath).replaceAll('\\', '/'),
      bytes: statSync(absolutePath).size,
      sha256: hashFile(absolutePath),
    }
  })
  const result = {
    schema: 'dsh.build-result.v1',
    state,
    command,
    outputRoot: relative(absoluteRoot, absoluteOutput).replaceAll('\\', '/'),
    completedAtUtc: new Date().toISOString(),
    files: entries,
  }
  const absoluteResult = resolve(resultPath)
  mkdirSync(dirname(absoluteResult), { recursive: true })
  writeFileSync(absoluteResult, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`build-result: ${JSON.stringify({ path: relative(absoluteRoot, absoluteResult).replaceAll('\\', '/'), state, outputRoot: result.outputRoot, files: entries })}`)
  return result
}

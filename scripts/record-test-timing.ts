#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const args = process.argv.slice(2)

let label = ''
let outputDir = 'test-results/timings'
let separatorIndex = args.indexOf('--')

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]

  if (arg === '--') {
    separatorIndex = index
    break
  }

  if (arg === '--label') {
    label = args[index + 1] ?? ''
    index += 1
    continue
  }

  if (arg === '--output-dir') {
    outputDir = args[index + 1] ?? outputDir
    index += 1
    continue
  }
}

if (!label) {
  console.error('Usage: bun scripts/record-test-timing.ts --label <name> [--output-dir <dir>] -- <command> [args...]')
  process.exit(1)
}

if (separatorIndex === -1) {
  console.error('Missing `--` separator before the command to execute.')
  process.exit(1)
}

const command = args.slice(separatorIndex + 1)

if (command.length === 0) {
  console.error('Missing command to execute.')
  process.exit(1)
}

const startedAt = new Date()
const startedAtMs = performance.now()
const processHandle = Bun.spawn(command, {
  stdout: 'inherit',
  stderr: 'inherit',
  env: process.env,
})
const exitCode = await processHandle.exited
const durationMs = performance.now() - startedAtMs

const outputPath = resolve(outputDir)
await mkdir(outputPath, { recursive: true })

const safeLabel = label.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'timing'
const artifactPath = join(outputPath, `${safeLabel}.json`)
const artifact = {
  label,
  command,
  cwd: process.cwd(),
  startedAt: startedAt.toISOString(),
  durationMs: Number(durationMs.toFixed(2)),
  durationSeconds: Number((durationMs / 1000).toFixed(3)),
  exitCode,
  artifactPath: basename(artifactPath),
}

await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(artifact))

process.exit(exitCode)

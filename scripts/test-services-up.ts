#!/usr/bin/env bun

import {
  getExternalTestServicesComposeArgs,
  getExternalTestServicesRecoveryCommands,
} from '../packages/test-fixtures/src/external-test-services'

// Profiling helper: runs a labeled phase, prints how long it took, and aborts
// on failure. Phase timings are emitted in a consistent `[test-services]`
// format so they are easy to spot in both local terminals and CI logs.
async function runPhase(label: string, command: string[]): Promise<void> {
  const startedAt = performance.now()
  console.log(`[test-services] ${label}: starting (${command.join(' ')})`)

  const child = Bun.spawn(command, {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  const durationSeconds = ((performance.now() - startedAt) / 1000).toFixed(1)

  if (exitCode !== 0) {
    const commands = getExternalTestServicesRecoveryCommands()
    console.error(`[test-services] ${label}: FAILED after ${durationSeconds}s (exit ${exitCode})`)
    console.error(`Try: ${commands.logs}`)
    console.error(`Reset: ${commands.down}`)
    process.exit(exitCode)
  }

  console.log(`[test-services] ${label}: done in ${durationSeconds}s`)
}

const totalStart = performance.now()

// Build any locally-built images (e.g. durable-streams) as a distinct phase so
// the Docker build cost is visible separately from image pulls and container
// startup. `up -d` would build implicitly, but timing it on its own makes it
// obvious in the logs when the build cache is cold vs warm.
await runPhase('build images', getExternalTestServicesComposeArgs(['build']))

// Pull only upstream images that are not already available locally. This keeps
// repeat local runs independent of registry availability while still populating
// a fresh developer or CI environment.
await runPhase('pull missing images', getExternalTestServicesComposeArgs(['pull', '--ignore-buildable', '--policy', 'missing']))

await runPhase('start containers', getExternalTestServicesComposeArgs(['up', '-d', '--remove-orphans']))

const totalSeconds = ((performance.now() - totalStart) / 1000).toFixed(1)
console.log(`[test-services] services up in ${totalSeconds}s (waiting for readiness next)`)

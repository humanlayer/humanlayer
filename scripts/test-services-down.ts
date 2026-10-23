#!/usr/bin/env bun

import {
  getExternalTestServicesComposeArgs,
  getExternalTestServicesRecoveryCommands,
} from '../packages/test-fixtures/src/external-test-services'

const removeVolumes = process.argv.includes('--volumes')
const args = ['down', '--remove-orphans']

if (removeVolumes) {
  args.push('-v')
}

const command = getExternalTestServicesComposeArgs(args)
const child = Bun.spawn(command, {
  stdout: 'inherit',
  stderr: 'inherit',
})
const exitCode = await child.exited

if (exitCode !== 0) {
  const commands = getExternalTestServicesRecoveryCommands()

  console.error('Failed to stop external test services.')
  console.error(`Inspect logs with: ${commands.logs}`)
  process.exit(exitCode)
}

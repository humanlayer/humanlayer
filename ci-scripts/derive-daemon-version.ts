#!/usr/bin/env bun

/**
 * Derive the CLI-series daemon version at the current commit and print it to
 * stdout. This is the version a desktop build targets when it offers to update
 * a remote CLI daemon: the app never pushes a daemon past the version its own
 * commit corresponds to.
 *
 * The number is deriveVersion(apps/cli/package.json, CLI_COUNT_PATHS) plus the
 * channel suffix the CLI publish workflow appends (dev '-dev.0', beta
 * '-beta.0', prod ''). Because the derivation counts only commits at or before
 * HEAD, the result always equals the CLI version published at or before this
 * commit, so it is installable via `npm install -g @humanlayer/cli@<version>`
 * and never exceeds the latest published version.
 *
 * IMPORTANT: CLI_COUNT_PATHS must match the COUNT_PATHS the CLI release
 * workflow uses. If they drift, this targets a version npm never published.
 *
 * Reads INPUT_RELEASE_TYPE ('dev' | 'beta' | 'prod', like generate-version.ts).
 * Requires a full clone (fetch-depth: 0).
 */

import { deriveVersion } from './derive-version'
import type { ReleaseType } from './types'

const CLI_VERSION_FILE = 'apps/cli/package.json'

const CLI_COUNT_PATHS = [
  'apps/cli',
  'apps/riptide-daemon',
  'contracts/riptide-api-contract',
  'scripts/bun-build-plugins/embed-photon-wasm.ts',
]

const CHANNEL_SUFFIX: Record<ReleaseType, string> = {
  dev: '-dev.0',
  beta: '-beta.0',
  prod: '',
}

const releaseType = process.env.INPUT_RELEASE_TYPE as ReleaseType | undefined

if (!releaseType || !['dev', 'beta', 'prod'].includes(releaseType)) {
  console.error(`ERROR: INPUT_RELEASE_TYPE must be 'dev', 'beta', or 'prod' (got '${releaseType}')`)
  process.exit(1)
}

try {
  const base = deriveVersion({ versionFile: CLI_VERSION_FILE, countPaths: CLI_COUNT_PATHS })
  const version = `${base}${CHANNEL_SUFFIX[releaseType]}`
  console.error(`Derived daemon version ${version} for release type ${releaseType}`)
  console.log(version)
} catch (err) {
  console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

#!/usr/bin/env bun

/**
 * Derive the publish version for an npm CLI package and print it to stdout.
 *
 * The version committed in the package's package.json is a base; the
 * published version is base patch + the number of first-parent commits
 * touching COUNT_PATHS since the base last changed (see derive-version.ts).
 * The publish workflows stamp the derived version into package.json in the
 * CI workspace before publishing — it is never committed, so PRs never touch
 * version fields and never merge-conflict on them.
 *
 * IMPORTANT: a release publishes when the derived version isn't on npm yet,
 * so a change that should publish must touch a path in COUNT_PATHS. If it
 * doesn't, the derived version doesn't change and the publish is skipped.
 *
 * Reads from environment variables:
 * - VERSION_FILE: repo-relative path to the package.json (required)
 * - COUNT_PATHS: whitespace-separated paths whose commits count (required)
 *
 * Requires a full clone (fetch-depth: 0).
 */

import { deriveVersion } from './derive-version'

const versionFile = process.env.VERSION_FILE
const countPaths = (process.env.COUNT_PATHS ?? '').split(/\s+/).filter(Boolean)

if (!versionFile) {
  console.error('ERROR: VERSION_FILE env var is required')
  process.exit(1)
}
if (countPaths.length === 0) {
  console.error('ERROR: COUNT_PATHS env var is required (see header comment)')
  process.exit(1)
}

try {
  const version = deriveVersion({ versionFile, countPaths })
  console.error(`Derived ${version} from ${versionFile} counting: ${countPaths.join(' ')}`)
  console.log(version)
} catch (err) {
  console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

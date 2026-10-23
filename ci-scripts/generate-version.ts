#!/usr/bin/env bun

/**
 * Generate version information for Riptide releases.
 *
 * Reads from environment variables (set by GitHub Actions):
 * - INPUT_RELEASE_TYPE: 'dev' | 'beta' | 'prod'
 * - INPUT_RELEASE_VERSION: Optional explicit version override (e.g., '0.2.0')
 *
 * Version selection (unless INPUT_RELEASE_VERSION is provided):
 * - dev/beta/prod: DERIVED. The committed version is a base; the released patch is
 *   base patch + the number of first-parent commits since that base version
 *   was introduced. Every merge to main gets a strictly increasing version
 *   without committing a bump, so PR branches never touch the version files
 *   and never merge-conflict on them. The derived version must be stamped
 *   into the build files with ci-scripts/stamp-version.ts before building —
 *   it is never committed.
 *
 * To cut a minor/major (or line up a prod release), edit the base version in
 * tauri.conf.json, package.json, and Cargo.toml in a PR. Requires a full
 * clone (fetch-depth: 0) for every release channel.
 *
 * Outputs key=value pairs to stdout for GITHUB_OUTPUT consumption.
 */

import { deriveVersion } from './derive-version'
import type { ReleaseType, VersionOutput } from './types'

const TAURI_CONF_PATH = 'apps/riptide-native/tauri.conf.json'

function deriveRiptideVersion(): string {
  try {
    // No countPaths: every merge to main cuts a dev build, so every commit counts
    return deriveVersion({ versionFile: TAURI_CONF_PATH })
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

function formatTimestamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
}

function generateVersion(): VersionOutput {
  const releaseType = process.env.INPUT_RELEASE_TYPE as ReleaseType | undefined
  const inputVersion = process.env.INPUT_RELEASE_VERSION

  if (!releaseType || !['dev', 'beta', 'prod'].includes(releaseType)) {
    console.error(`ERROR: INPUT_RELEASE_TYPE must be 'dev', 'beta', or 'prod' (got '${releaseType}')`)
    process.exit(1)
  }

  // Explicit input wins; otherwise the same commit derives the same version
  // for dev, beta, and prod.
  const version = inputVersion || deriveRiptideVersion()

  // Release tag: prod uses plain semver tag, dev/beta add timestamp for uniqueness
  const releaseTag = releaseType === 'prod'
    ? `riptide-v${version}`
    : `riptide-${releaseType}-v${version}-${formatTimestamp()}`

  // DMG naming: prod → "Riptide-darwin-arm64.dmg", others → "Riptide-{Variant}-darwin-arm64.dmg"
  const variantMap: Record<ReleaseType, string> = { dev: 'Dev', beta: 'Beta', prod: 'Stable' }
  const dmgVariant = variantMap[releaseType]
  const dmgFilename = releaseType === 'prod'
    ? 'Riptide-darwin-arm64.dmg'
    : `Riptide-${dmgVariant}-darwin-arm64.dmg`
  const canonicalDmgFilename = releaseType === 'prod'
    ? 'HumanLayer.dmg'
    : `HumanLayer-${dmgVariant}.dmg`

  // Updater artifact naming: prod → "Riptide.app.tar.gz", others → "Riptide-{Variant}.app.tar.gz"
  const updaterArtifactName = releaseType === 'prod'
    ? 'Riptide.app.tar.gz'
    : `Riptide-${dmgVariant}.app.tar.gz`

  return {
    release_version: version,
    release_type: releaseType,
    release_tag: releaseTag,
    dmg_filename: dmgFilename,
    canonical_dmg_filename: canonicalDmgFilename,
    dmg_variant: dmgVariant,
    updater_artifact_name: updaterArtifactName,
  }
}

// Generate and output in GitHub Actions format
const output = generateVersion()

// Log human-readable summary to stderr (doesn't affect GITHUB_OUTPUT)
console.error(`Build Version: ${output.release_version}`)
console.error(`Release Type: ${output.release_type}`)
console.error(`Release Tag: ${output.release_tag}`)

// Output key=value pairs to stdout for GITHUB_OUTPUT
for (const [key, value] of Object.entries(output)) {
  console.log(`${key}=${value}`)
}

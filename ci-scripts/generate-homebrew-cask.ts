#!/usr/bin/env bun

/**
 * Generate Homebrew cask files for HumanLayer (formerly Riptide) releases.
 *
 * Each release type produces TWO cask files that point at the same artifact:
 *  - the legacy `riptide{-variant}` cask, which keeps installing the app under
 *    its old `Riptide{-Variant}.app` name (via the `app ... target:` rename) so
 *    existing users' /Applications entry is unchanged; and
 *  - the new `humanlayer{-variant}` cask, which installs the app under its real
 *    bundle name `HumanLayer{-Variant}.app`.
 *
 * The .app bundle INSIDE the DMG is always named after the Tauri `productName`
 * (HumanLayer / HumanLayer-Beta / HumanLayer-Dev — see
 * apps/riptide-native/tauri.*.conf.json), so that is the source `app` name for
 * both casks. The two casks are mutually exclusive via `conflicts_with` since
 * they install the same artifact and daemon binary.
 *
 * Reads from environment variables:
 * - RELEASE_TYPE: 'dev' | 'beta' | 'prod'
 * - RELEASE_VERSION: The version string (e.g., '0.1.0')
 * - SHA256: SHA256 hash of the DMG file
 * - DMG_URL: Download URL for the DMG
 * - OUTPUT_DIR: Directory to write the cask files into (e.g., 'homebrew-humanlayer/Casks')
 *
 * Outputs each cask file path to stdout for verification.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReleaseType } from './types'

interface CaskConfig {
  releaseType: ReleaseType
  releaseVersion: string
  sha256: string
  dmgUrl: string
  outputDir: string
}

interface CaskSpec {
  // Cask token + filename (e.g. 'riptide-beta', 'humanlayer-beta').
  slug: string
  // Name the .app is installed as in /Applications, and the cask `name` stanza.
  // Legacy casks keep the old 'Riptide*' name; new casks use the real bundle name.
  installedAppName: string
}

// Real .app bundle name inside the DMG. Must match the Tauri `productName` in
// apps/riptide-native/tauri.*.conf.json — this is the source `app` name.
function getBundleName(releaseType: ReleaseType): string {
  const map: Record<ReleaseType, string> = {
    dev: 'HumanLayer-Dev',
    beta: 'HumanLayer-Beta',
    prod: 'HumanLayer',
  }
  return map[releaseType]
}

// Old app name the legacy `riptide*` casks installed under, preserved via
// `app ... target:` so upgrading users keep their existing /Applications entry.
function getLegacyAppName(releaseType: ReleaseType): string {
  const map: Record<ReleaseType, string> = {
    dev: 'Riptide-Dev',
    beta: 'Riptide-Beta',
    prod: 'Riptide',
  }
  return map[releaseType]
}

// Both casks for a release type, in the order they should be written.
function getCaskSpecs(releaseType: ReleaseType): CaskSpec[] {
  const legacySlug: Record<ReleaseType, string> = {
    dev: 'riptide-dev',
    beta: 'riptide-beta',
    prod: 'riptide',
  }
  const modernSlug: Record<ReleaseType, string> = {
    dev: 'humanlayer-dev',
    beta: 'humanlayer-beta',
    prod: 'humanlayer',
  }
  return [
    { slug: legacySlug[releaseType], installedAppName: getLegacyAppName(releaseType) },
    { slug: modernSlug[releaseType], installedAppName: getBundleName(releaseType) },
  ]
}

function getIdentifier(releaseType: ReleaseType): string {
  const map: Record<ReleaseType, string> = {
    dev: 'com.humanlayer.riptide.dev',
    beta: 'com.humanlayer.riptide.beta',
    prod: 'com.humanlayer.riptide',
  }
  return map[releaseType]
}

function getDaemonTarget(releaseType: ReleaseType): string {
  const map: Record<ReleaseType, string> = {
    dev: 'riptided-dev',
    beta: 'riptided-beta',
    prod: 'riptided',
  }
  return map[releaseType]
}

function getDescription(releaseType: ReleaseType): string {
  const map: Record<ReleaseType, string> = {
    dev: 'Development build of HumanLayer pointing at dev environment',
    beta: 'Beta build of HumanLayer pointing at beta environment',
    prod: 'AI coding agent powered by Claude',
  }
  return map[releaseType]
}

function generateCaskContent(config: CaskConfig, spec: CaskSpec, conflictsWith: string[]): string {
  const bundleName = getBundleName(config.releaseType)
  const installedAppName = spec.installedAppName
  const identifier = getIdentifier(config.releaseType)
  const daemonTarget = getDaemonTarget(config.releaseType)
  const description = getDescription(config.releaseType)

  // Rename the bundle on install only when the desired installed name differs
  // from the real bundle name inside the DMG.
  const appStanza =
    installedAppName === bundleName
      ? `  app "${bundleName}.app"`
      : `  app "${bundleName}.app", target: "${installedAppName}.app"`

  // Runtime data dirs are created by the app itself based on its baked-in
  // identifier/productName, so zap targets the real bundle name regardless of
  // the installed (possibly renamed) app name. Kept alphabetized for `brew style`.
  const zapPaths = [
    `~/.humanlayer/riptide/logs/error-riptide-${config.releaseType}-*.jsonl`,
    `~/.humanlayer/riptide/logs/riptide-${config.releaseType}-*.jsonl`,
    `~/Library/Application Support/${bundleName}`,
    `~/Library/Logs/${identifier}/`,
    `~/Library/Preferences/${identifier}.plist`,
    `~/Library/Saved Application State/${identifier}.savedState`,
  ]
  const zapList = zapPaths.map((p) => `    "${p}",`).join('\n')

  const conflictsLine =
    conflictsWith.length > 0
      ? `  conflicts_with cask: ${conflictsWith.map((c) => `"${c}"`).join(', ')}\n`
      : ''

  return `cask "${spec.slug}" do
  version "${config.releaseVersion}"
  sha256 "${config.sha256}"

  url "${config.dmgUrl}"
  name "${installedAppName}"
  desc "${description}"
  homepage "https://humanlayer.dev/"

  auto_updates true
${conflictsLine}  depends_on :macos

${appStanza}
  binary "#{appdir}/${installedAppName}.app/Contents/Resources/bin/riptided", target: "${daemonTarget}"

  zap trash: [
${zapList}
  ]
end
`
}

function main() {
  const releaseType = process.env.RELEASE_TYPE as ReleaseType
  const releaseVersion = process.env.RELEASE_VERSION
  const sha256 = process.env.SHA256
  const dmgUrl = process.env.DMG_URL
  const outputDir = process.env.OUTPUT_DIR

  // Validate required inputs
  const missing: string[] = []
  if (!releaseType) missing.push('RELEASE_TYPE')
  if (!releaseVersion) missing.push('RELEASE_VERSION')
  if (!sha256) missing.push('SHA256')
  if (!dmgUrl) missing.push('DMG_URL')
  if (!outputDir) missing.push('OUTPUT_DIR')

  if (missing.length > 0) {
    console.error(`ERROR: Missing required environment variables: ${missing.join(', ')}`)
    process.exit(1)
  }

  if (!['dev', 'beta', 'prod'].includes(releaseType)) {
    console.error(`ERROR: Invalid RELEASE_TYPE: ${releaseType}`)
    console.error('  Expected: dev, beta, or prod')
    process.exit(1)
  }

  const config: CaskConfig = {
    releaseType,
    releaseVersion: releaseVersion!,
    sha256: sha256!,
    dmgUrl: dmgUrl!,
    outputDir: outputDir!,
  }

  // Ensure directory exists
  mkdirSync(config.outputDir, { recursive: true })

  const specs = getCaskSpecs(releaseType)
  for (const spec of specs) {
    const conflictsWith = specs.filter((s) => s.slug !== spec.slug).map((s) => s.slug)
    const content = generateCaskContent(config, spec, conflictsWith)
    const outputPath = join(config.outputDir, `${spec.slug}.rb`)
    writeFileSync(outputPath, content)

    console.error(`Generated ${spec.slug} cask file (installs as ${spec.installedAppName}.app)`)
    console.error(`  Version: ${releaseVersion}`)
    console.error(`  Output: ${outputPath}`)

    // Output path for verification
    console.log(`cask_path=${outputPath}`)
  }
}

main()

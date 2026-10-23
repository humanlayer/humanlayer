#!/usr/bin/env bun

/**
 * Derive and stamp the Claude plugin versions before a daemon-embedding build
 * (riptide dev/beta/prod releases and the humanlayer CLI release).
 *
 * The committed plugin.json versions are bases; the shipped version is
 * base patch + first-parent commits touching that plugin's content since the
 * base last changed (see derive-version.ts). The daemon reads PLUGIN_VERSION
 * from the embedded manifest and keys its install dir on it, so every plugin
 * content change ships under a fresh version — no manual bump, no hash.
 * Stamped in the CI workspace only, never committed.
 *
 * Local dev never uses these versions — daemon dev
 * scripts set RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN and serve from source.
 *
 * Requires a full clone (fetch-depth: 0).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deriveVersion } from './derive-version'

const PLUGINS = [
  {
    name: 'riptide-humanlayer',
    manifest: 'apps/riptide-humanlayer-claude-plugin/.claude-plugin/plugin.json',
    countPaths: [
      'apps/riptide-humanlayer-claude-plugin',
      'apps/riptide-daemon/src/plugins/bundled-humanlayer-plugin.ts',
    ],
  },
  {
    name: 'riptide-rpi',
    manifest: 'apps/riptide-rpi-claude-plugin/.claude-plugin/plugin.json',
    countPaths: ['apps/riptide-rpi-claude-plugin', 'apps/riptide-daemon/src/plugins/bundled-rpi-plugin.ts'],
  },
]

for (const plugin of PLUGINS) {
  const version = deriveVersion({ versionFile: plugin.manifest, countPaths: plugin.countPaths })
  const path = resolve(plugin.manifest)
  const content = readFileSync(path, 'utf-8')
  const updated = content.replace(/^(\s*)"version": "[^"]+"/m, `$1"version": "${version}"`)
  JSON.parse(updated) // fail loudly rather than write a broken manifest
  writeFileSync(path, updated)
  console.error(`Stamped ${plugin.name} ${version} into ${plugin.manifest}`)
}

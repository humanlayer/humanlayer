#!/usr/bin/env bun

/**
 * Stamp a release version into the desktop hosts' build files, in the CI
 * workspace only — the result is never committed. Run after
 * generate-version.ts derives the dev/beta version so the app bundles and
 * updater artifacts carry it, while the committed files keep the base version.
 *
 * package.json is deliberately NOT stamped: nothing consumes its version
 * field at build time (Tauri reads tauri.conf.json, the crate reads
 * Cargo.toml), and bun.lock records the workspace version so leaving it
 * untouched keeps `bun install --frozen-lockfile` out of the blast radius.
 *
 * Reads from environment variables:
 * - VERSION: the version to stamp (e.g., '0.134.7')
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const version = process.env.VERSION

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
	console.error(`ERROR: VERSION must be a plain x.y.z version (got '${version}')`)
	process.exit(1)
}

const targets: Array<{ path: string; pattern: RegExp; replacement: string }> = [
	{
		path: 'apps/riptide-native/tauri.conf.json',
		pattern: /^(\s*)"version": "[^"]+"/m,
		replacement: `$1"version": "${version}"`,
	},
	{
		path: 'apps/riptide-native/Cargo.toml',
		pattern: /^version = "[^"]+"/m,
		replacement: `version = "${version}"`,
	},
	{
		path: 'apps/riptide-electron/electron-builder.yml',
		pattern: /^(\s*)version: [^\n]+/m,
		replacement: `$1version: ${version}`,
	},
]

for (const target of targets) {
	const absolutePath = resolve(target.path)
	const content = readFileSync(absolutePath, 'utf-8')
	if (!target.pattern.test(content)) {
		console.error(`ERROR: no version field found in ${target.path}`)
		process.exit(1)
	}
	const updated = content.replace(target.pattern, target.replacement)
	if (target.path.endsWith('.json')) {
		JSON.parse(updated) // fail loudly rather than write a broken file
	}
	writeFileSync(absolutePath, updated)
	console.error(`Stamped ${version} into ${target.path}`)
}

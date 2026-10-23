/**
 * Bun macros for CLI environment configuration.
 * These are evaluated at BUILD TIME, never at runtime.
 *
 * This file should NEVER be imported directly by anything other than ./index.ts
 * to ensure the `with { type: 'macro' }` import attribute is always applied.
 *
 * At build time, CI passes environment variables for both beta and prod.
 * At runtime, the CLI selects which set to use based on the --beta flag.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function env(key: string): string | undefined {
	return process.env[key]
}

export function BuildVersionMacro(): string {
	// Use fileURLToPath(import.meta.url) rather than Bun's `import.meta.dir` so this resolves under
	// both the Bun macro build and the Node runtime vitest uses (where `import.meta.dir` is undefined).
	const dir = path.dirname(fileURLToPath(import.meta.url))
	const pkgPath = path.join(dir, '..', '..', '..', 'package.json')
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
	return pkg.version
}

// Beta environment
export function BetaWorkosClientIdMacro() {
	return env('BETA_WORKOS_CLIENT_ID')
}

export function BetaApiOriginMacro() {
	return env('BETA_API_ORIGIN')
}

export function BetaSyncOriginMacro() {
	return env('BETA_SYNC_ORIGIN')
}

export function BetaCloudOriginMacro() {
	return env('BETA_CLOUD_ORIGIN')
}

export function BetaAppOriginMacro() {
	return env('BETA_APP_ORIGIN')
}

// Dev environment
export function DevWorkosClientIdMacro() {
	return env('DEV_WORKOS_CLIENT_ID') ?? env('WORKOS_CLIENT_ID')
}

export function LocalWorkosClientIdMacro() {
	return env('DEV_WORKOS_CLIENT_ID') ?? env('VITE_PUBLIC_WORKOS_CLIENT_ID') ?? env('WORKOS_CLIENT_ID')
}

export function DevApiOriginMacro() {
	return env('DEV_API_ORIGIN')
}

export function DevSyncOriginMacro() {
	return env('DEV_SYNC_ORIGIN')
}

export function DevCloudOriginMacro() {
	return env('DEV_CLOUD_ORIGIN')
}

export function DevAppOriginMacro() {
	return env('DEV_APP_ORIGIN')
}

// Prod environment
export function ProdWorkosClientIdMacro() {
	return env('PROD_WORKOS_CLIENT_ID')
}

export function ProdApiOriginMacro() {
	return env('PROD_API_ORIGIN')
}

export function ProdSyncOriginMacro() {
	return env('PROD_SYNC_ORIGIN')
}

export function ProdCloudOriginMacro() {
	return env('PROD_CLOUD_ORIGIN')
}

export function ProdAppOriginMacro() {
	return env('PROD_APP_ORIGIN')
}

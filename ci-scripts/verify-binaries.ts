#!/usr/bin/env bun

/**
 * Verify either a legacy directory of required binaries or a packaged
 * Electron application. Electron verification checks the complete executable
 * resource layout and can additionally enforce release signatures and
 * entitlements.
 *
 * Legacy mode:
 * - BINARIES_DIR
 * - REQUIRED_BINARIES (comma-separated)
 *
 * Electron mode:
 * - ELECTRON_APP_PATH
 * - EXPECTED_ARCH (default: arm64)
 * - EXPECTED_APP_ID
 * - EXPECTED_URL_SCHEMES (comma-separated)
 * - REQUIRE_SIGNED (default: false)
 * - APP_ENTITLEMENTS_FILE (required when REQUIRE_SIGNED=true)
 * - DAEMON_ENTITLEMENTS_FILE (required when REQUIRE_SIGNED=true)
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

interface BinaryCheck {
	name: string
	path: string
	exists: boolean
	nonEmpty: boolean
	executable: boolean
}

interface ToolResult {
	stdout: string
	stderr: string
}

export type ToolRunner = (command: string, args: ReadonlyArray<string>) => ToolResult

export interface ElectronVerificationOptions {
	appPath: string
	expectedArchitecture: string
	expectedAppId?: string
	expectedSchemes: ReadonlyArray<string>
	requireSigned: boolean
	appEntitlementsPath?: string
	daemonEntitlementsPath?: string
	runTool?: ToolRunner
}

const defaultToolRunner: ToolRunner = (command, args) => {
	const result = spawnSync(command, args, { encoding: 'utf8' })
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
	}
	return { stdout: result.stdout, stderr: result.stderr }
}

function checkBinary(binDir: string, name: string): BinaryCheck {
	const path = join(binDir, name)
	const check: BinaryCheck = {
		name,
		path,
		exists: false,
		nonEmpty: false,
		executable: false,
	}

	if (!existsSync(path)) return check

	check.exists = true
	const stat = statSync(path)
	check.nonEmpty = stat.size > 0
	check.executable = (stat.mode & 0o111) !== 0
	return check
}

function checkFile(path: string, description: string, executable: boolean, errors: string[]): void {
	if (!existsSync(path)) {
		errors.push(`${description}: not found at ${path}`)
		return
	}
	const stat = statSync(path)
	if (!stat.isFile()) errors.push(`${description}: expected a regular file at ${path}`)
	if (stat.size === 0) errors.push(`${description}: file is empty at ${path}`)
	if (executable && (stat.mode & 0o111) === 0) errors.push(`${description}: file is not executable at ${path}`)
}

function runCheck(description: string, errors: string[], effect: () => void): void {
	try {
		effect()
		console.error(`  ✓ ${description}`)
	} catch (error) {
		errors.push(`${description}: ${error instanceof Error ? error.message : String(error)}`)
	}
}

function parsePlist(path: string, runTool: ToolRunner): Record<string, unknown> {
	const result = runTool('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path])
	return JSON.parse(result.stdout) as Record<string, unknown>
}

function architectureFor(path: string, runTool: ToolRunner): ReadonlyArray<string> {
	return runTool('/usr/bin/lipo', ['-archs', path]).stdout.trim().split(/\s+/).filter(Boolean)
}

function assertExactArchitecture(path: string, expected: string, runTool: ToolRunner): void {
	const architectures = architectureFor(path, runTool)
	if (architectures.length !== 1 || architectures[0] !== expected) {
		throw new Error(`expected ${expected}, found ${architectures.join(', ') || 'no architecture'}`)
	}
}

function plistKeys(content: string): ReadonlyArray<string> {
	return [...content.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]!)
}

function assertEntitlements(path: string, expectedPath: string, runTool: ToolRunner): void {
	const result = runTool('/usr/bin/codesign', ['--display', '--entitlements', ':-', path])
	const signedKeys = [...new Set(plistKeys(`${result.stdout}\n${result.stderr}`))].sort()
	const expectedKeys = [...new Set(plistKeys(readFileSync(expectedPath, 'utf8')))].sort()
	if (JSON.stringify(signedKeys) !== JSON.stringify(expectedKeys)) {
		throw new Error(`expected entitlement keys [${expectedKeys.join(', ')}], found [${signedKeys.join(', ')}]`)
	}
}

function helperApplications(appPath: string): ReadonlyArray<string> {
	const frameworksPath = join(appPath, 'Contents', 'Frameworks')
	if (!existsSync(frameworksPath)) return []
	return readdirSync(frameworksPath, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name.includes(' Helper') && entry.name.endsWith('.app'))
		.map((entry) => join(frameworksPath, entry.name))
}

function verifyPackagedRenderer(resourcesPath: string, errors: string[]): void {
	const rendererPath = join(resourcesPath, 'renderer')
	const indexPath = join(rendererPath, 'index.html')
	if (!existsSync(indexPath)) {
		errors.push(`packaged renderer: not found at ${indexPath}`)
		return
	}

	const html = readFileSync(indexPath, 'utf8')
	if (/\b(?:src|href)=["']\.\/assets\//.test(html)) {
		errors.push('packaged renderer: asset URLs must be root-relative for the renderer scheme, not relative')
	}

	const assetReferences = [...html.matchAll(/\b(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(
		(match) => match[1]!,
	)
	if (assetReferences.length === 0) {
		errors.push('packaged renderer: no root-relative asset references found')
	}
	for (const assetReference of assetReferences) {
		const assetPath = join(rendererPath, assetReference.slice(1))
		if (!existsSync(assetPath)) errors.push(`packaged renderer asset: not found at ${assetPath}`)
	}

	const contentSecurityPolicyTag = [...html.matchAll(/<meta\b[^>]*>/gi)]
		.map((match) => match[0])
		.find((tag) => /http-equiv=["']Content-Security-Policy["']/i.test(tag))
	if (contentSecurityPolicyTag === undefined) {
		errors.push('packaged renderer: Content-Security-Policy meta tag is missing')
		return
	}
	const encodedPolicy =
		contentSecurityPolicyTag.match(/content="([^"]+)"/i)?.[1] ??
		contentSecurityPolicyTag.match(/content='([^']+)'/i)?.[1]
	if (encodedPolicy === undefined) {
		errors.push('packaged renderer: Content-Security-Policy content is missing')
		return
	}
	const policy = encodedPolicy.replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&')
	for (const requiredDirective of ["default-src 'self'", "script-src 'self'", "object-src 'none'"]) {
		if (!policy.includes(requiredDirective)) {
			errors.push(`packaged renderer: Content-Security-Policy is missing ${requiredDirective}`)
		}
	}
	if (policy.includes("'unsafe-eval'")) {
		errors.push("packaged renderer: Content-Security-Policy must not allow 'unsafe-eval'")
	}
}

export function verifyElectronApp(options: ElectronVerificationOptions): ReadonlyArray<string> {
	const errors: string[] = []
	const runTool = options.runTool ?? defaultToolRunner
	const contentsPath = join(options.appPath, 'Contents')
	const resourcesPath = join(contentsPath, 'Resources')
	const infoPlistPath = join(contentsPath, 'Info.plist')
	const daemonPath = join(resourcesPath, 'bin', 'riptided')
	const nodePtyPath = join(
		resourcesPath,
		'app.asar.unpacked',
		'node_modules',
		'node-pty',
		'build',
		'Release',
		'pty.node',
	)
	const spawnHelperPath = join(
		resourcesPath,
		'app.asar.unpacked',
		'node_modules',
		'node-pty',
		'build',
		'Release',
		'spawn-helper',
	)

	if (!existsSync(options.appPath)) return [`Electron app: not found at ${options.appPath}`]
	if (!existsSync(infoPlistPath)) return [`Electron Info.plist: not found at ${infoPlistPath}`]

	let plist: Record<string, unknown> | undefined
	runCheck('Electron Info.plist', errors, () => {
		plist = parsePlist(infoPlistPath, runTool)
	})

	const executableName =
		typeof plist?.CFBundleExecutable === 'string' ? plist.CFBundleExecutable : basename(options.appPath, '.app')
	const appExecutablePath = join(contentsPath, 'MacOS', executableName)
	const executableFiles = [
		{ path: appExecutablePath, description: 'Electron app executable', executable: true },
		{ path: daemonPath, description: 'riptided resource', executable: true },
		{ path: nodePtyPath, description: 'node-pty native addon', executable: false },
		{ path: spawnHelperPath, description: 'node-pty spawn helper', executable: true },
	] as const

	for (const file of executableFiles) checkFile(file.path, file.description, file.executable, errors)
	verifyPackagedRenderer(resourcesPath, errors)

	if (options.expectedAppId !== undefined && plist?.CFBundleIdentifier !== options.expectedAppId) {
		errors.push(`bundle identifier: expected ${options.expectedAppId}, found ${String(plist?.CFBundleIdentifier)}`)
	}

	const urlTypes = Array.isArray(plist?.CFBundleURLTypes) ? plist.CFBundleURLTypes : []
	const schemes = urlTypes.flatMap((entry) => {
		if (typeof entry !== 'object' || entry === null) return []
		const value = Reflect.get(entry, 'CFBundleURLSchemes')
		return Array.isArray(value) ? value.filter((scheme): scheme is string => typeof scheme === 'string') : []
	})
	for (const scheme of options.expectedSchemes) {
		if (!schemes.includes(scheme)) errors.push(`URL schemes: missing ${scheme}; found [${schemes.join(', ')}]`)
	}

	for (const file of executableFiles) {
		if (!existsSync(file.path)) continue
		runCheck(`${file.description} architecture`, errors, () =>
			assertExactArchitecture(file.path, options.expectedArchitecture, runTool),
		)
	}

	if (options.requireSigned) {
		if (!options.appEntitlementsPath) errors.push('signed verification: APP_ENTITLEMENTS_FILE is required')
		if (!options.daemonEntitlementsPath) errors.push('signed verification: DAEMON_ENTITLEMENTS_FILE is required')

		runCheck('Electron app signature', errors, () => {
			runTool('/usr/bin/codesign', ['--verify', '--deep', '--strict', options.appPath])
		})
		for (const file of executableFiles.slice(1)) {
			if (!existsSync(file.path)) continue
			runCheck(`${file.description} signature`, errors, () => {
				runTool('/usr/bin/codesign', ['--verify', '--strict', file.path])
			})
		}
		for (const helperPath of helperApplications(options.appPath)) {
			runCheck(`${basename(helperPath)} signature`, errors, () => {
				runTool('/usr/bin/codesign', ['--verify', '--strict', helperPath])
			})
			if (options.appEntitlementsPath) {
				runCheck(`${basename(helperPath)} entitlements`, errors, () =>
					assertEntitlements(helperPath, options.appEntitlementsPath!, runTool),
				)
			}
		}
		if (options.appEntitlementsPath) {
			runCheck('Electron app entitlements', errors, () =>
				assertEntitlements(options.appPath, options.appEntitlementsPath!, runTool),
			)
		}
		if (options.daemonEntitlementsPath && existsSync(daemonPath)) {
			runCheck('riptided entitlements', errors, () =>
				assertEntitlements(daemonPath, options.daemonEntitlementsPath!, runTool),
			)
		}
	}

	return errors
}

function verifyLegacyBinaries(): ReadonlyArray<string> {
	const binDir = process.env.BINARIES_DIR
	const requiredBinaries =
		process.env.REQUIRED_BINARIES?.split(',')
			.map((binary) => binary.trim())
			.filter(Boolean) ?? []
	if (!binDir) return ['BINARIES_DIR environment variable not set']
	if (requiredBinaries.length === 0) return ['REQUIRED_BINARIES environment variable not set or empty']

	console.error(`Verifying binaries in ${binDir}...`)
	const checks = requiredBinaries.map((name) => checkBinary(binDir, name))
	const errors: string[] = []
	for (const check of checks) {
		if (!check.exists) errors.push(`${check.name}: not found at ${check.path}`)
		else if (!check.nonEmpty) errors.push(`${check.name}: file is empty`)
		else if (!check.executable) errors.push(`${check.name}: file is not executable`)
		else console.error(`  ✓ ${check.name}`)
	}
	return errors
}

function main(): void {
	const electronAppPath = process.env.ELECTRON_APP_PATH
	const errors = electronAppPath
		? verifyElectronApp({
				appPath: electronAppPath,
				expectedArchitecture: process.env.EXPECTED_ARCH || 'arm64',
				expectedAppId: process.env.EXPECTED_APP_ID,
				expectedSchemes:
					process.env.EXPECTED_URL_SCHEMES?.split(',')
						.map((scheme) => scheme.trim())
						.filter(Boolean) ?? [],
				requireSigned: process.env.REQUIRE_SIGNED === 'true',
				appEntitlementsPath: process.env.APP_ENTITLEMENTS_FILE,
				daemonEntitlementsPath: process.env.DAEMON_ENTITLEMENTS_FILE,
			})
		: verifyLegacyBinaries()

	if (errors.length > 0) {
		console.error('\nVerification FAILED:')
		for (const error of errors) console.error(`  ✗ ${error}`)
		console.log('verified=false')
		process.exit(1)
	}

	console.error('\nAll binaries verified successfully!')
	console.log('verified=true')
}

if (import.meta.main) main()

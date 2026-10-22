import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { verifyElectronApp, type ToolRunner } from './verify-binaries'

const temporaryDirectories: string[] = []

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true })
	}
})

function createFile(path: string, executable = false): void {
	mkdirSync(join(path, '..'), { recursive: true })
	writeFileSync(path, 'fixture')
	if (executable) chmodSync(path, 0o755)
}

function createAppFixture() {
	const directory = mkdtempSync(join(tmpdir(), 'verify-electron-app-'))
	temporaryDirectories.push(directory)
	const appPath = join(directory, 'HumanLayerElectronDev.app')
	const resourcesPath = join(appPath, 'Contents', 'Resources')
	const nodePtyPath = join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty', 'build', 'Release')
	createFile(join(appPath, 'Contents', 'Info.plist'))
	createFile(join(appPath, 'Contents', 'MacOS', 'HumanLayerElectronDev'), true)
	createFile(join(resourcesPath, 'bin', 'riptided'), true)
	createFile(join(nodePtyPath, 'pty.node'))
	createFile(join(nodePtyPath, 'spawn-helper'), true)
	mkdirSync(join(appPath, 'Contents', 'Frameworks', 'HumanLayerElectronDev Helper.app'), {
		recursive: true,
	})
	createFile(join(resourcesPath, 'renderer', 'assets', 'index.js'))
	createFile(join(resourcesPath, 'renderer', 'assets', 'index.css'))
	writeFileSync(
		join(resourcesPath, 'renderer', 'index.html'),
		`<html><head>
			<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'">
			<script type="module" src="/assets/index.js"></script>
			<link rel="stylesheet" href="/assets/index.css">
		</head></html>`,
	)
	return { appPath, resourcesPath }
}

function toolRunner(options: { architecture?: string; entitlementKeys?: ReadonlyArray<string> } = {}): ToolRunner {
	return (command, args) => {
		if (command.endsWith('plutil')) {
			return {
				stdout: JSON.stringify({
					CFBundleExecutable: 'HumanLayerElectronDev',
					CFBundleIdentifier: 'com.humanlayer.electron.dev',
					CFBundleURLTypes: [{ CFBundleURLSchemes: ['humanlayer-electron-dev'] }],
				}),
				stderr: '',
			}
		}
		if (command.endsWith('lipo')) {
			return { stdout: `${options.architecture ?? 'arm64'}\n`, stderr: '' }
		}
		if (command.endsWith('codesign') && args.includes('--entitlements')) {
			const keys = options.entitlementKeys ?? [
				'com.apple.security.cs.allow-jit',
				'com.apple.security.cs.allow-unsigned-executable-memory',
				'com.apple.security.cs.disable-library-validation',
			]
			return {
				stdout: `<plist><dict>${keys.map((key) => `<key>${key}</key><true/>`).join('')}</dict></plist>`,
				stderr: '',
			}
		}
		return { stdout: '', stderr: '' }
	}
}

function baseOptions(appPath: string, runTool: ToolRunner) {
	return {
		appPath,
		expectedArchitecture: 'arm64',
		expectedAppId: 'com.humanlayer.electron.dev',
		expectedSchemes: ['humanlayer-electron-dev'],
		requireSigned: false,
		runTool,
	} as const
}

describe('verifyElectronApp', () => {
	test('checks the Electron app, daemon, node-pty, URL scheme, modes, and architecture', () => {
		const { appPath } = createAppFixture()
		expect(verifyElectronApp(baseOptions(appPath, toolRunner()))).toEqual([])
	})

	test('reports missing resources, a non-executable helper, and protocol mismatch', () => {
		const { appPath, resourcesPath } = createAppFixture()
		rmSync(join(resourcesPath, 'bin', 'riptided'))
		chmodSync(
			join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty', 'build', 'Release', 'spawn-helper'),
			0o644,
		)

		const errors = verifyElectronApp({
			...baseOptions(appPath, toolRunner()),
			expectedSchemes: ['missing-scheme'],
		})
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.stringContaining('riptided resource: not found'),
				expect.stringContaining('spawn helper: file is not executable'),
				expect.stringContaining('URL schemes: missing missing-scheme'),
			]),
		)
	})

	test('rejects relative, missing, or insecure packaged renderer assets', () => {
		const { appPath, resourcesPath } = createAppFixture()
		writeFileSync(
			join(resourcesPath, 'renderer', 'index.html'),
			`<html><head>
				<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-eval'">
				<script src="./assets/legacy.js"></script>
				<script src="/assets/missing.js"></script>
			</head></html>`,
		)

		const errors = verifyElectronApp(baseOptions(appPath, toolRunner()))
		expect(errors).toEqual(
			expect.arrayContaining([
				'packaged renderer: asset URLs must be root-relative for the renderer scheme, not relative',
				expect.stringContaining('packaged renderer asset: not found at'),
				"packaged renderer: Content-Security-Policy is missing object-src 'none'",
				"packaged renderer: Content-Security-Policy must not allow 'unsafe-eval'",
			]),
		)
	})

	test('rejects universal or wrong-architecture executables', () => {
		const { appPath } = createAppFixture()
		const errors = verifyElectronApp(baseOptions(appPath, toolRunner({ architecture: 'arm64 x86_64' })))
		expect(errors).toHaveLength(4)
		expect(errors.every((error) => error.includes('expected arm64, found arm64, x86_64'))).toBe(true)
	})

	test('checks app, helper, native-code signatures and exact signed entitlements', () => {
		const { appPath } = createAppFixture()
		const directory = join(appPath, '..')
		const appEntitlementsPath = join(directory, 'app-entitlements.plist')
		const daemonEntitlementsPath = join(directory, 'daemon-entitlements.plist')
		const entitlementContent = `<plist><dict>
      <key>com.apple.security.cs.allow-jit</key><true/>
      <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
      <key>com.apple.security.cs.disable-library-validation</key><true/>
    </dict></plist>`
		writeFileSync(appEntitlementsPath, entitlementContent)
		writeFileSync(daemonEntitlementsPath, entitlementContent)

		expect(
			verifyElectronApp({
				...baseOptions(appPath, toolRunner()),
				requireSigned: true,
				appEntitlementsPath,
				daemonEntitlementsPath,
			}),
		).toEqual([])
	})

	test('rejects unexpected signed entitlements', () => {
		const { appPath } = createAppFixture()
		const entitlementsPath = join(appPath, '..', 'entitlements.plist')
		writeFileSync(entitlementsPath, '<plist><dict><key>expected</key><true/></dict></plist>')
		const errors = verifyElectronApp({
			...baseOptions(appPath, toolRunner({ entitlementKeys: ['unexpected'] })),
			requireSigned: true,
			appEntitlementsPath: entitlementsPath,
			daemonEntitlementsPath: entitlementsPath,
		})
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.stringContaining('Electron app entitlements'),
				expect.stringContaining('riptided entitlements'),
			]),
		)
	})
})

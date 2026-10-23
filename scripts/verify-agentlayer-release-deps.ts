#!/usr/bin/env bun

import { dirname, join } from 'node:path'

const DEFAULT_EXPECTED_VERSION = '0.0.84'
const TOML_PACKAGE = '@iarna/toml'
const RELEASE_PACKAGE_PATTERN = /^(?:@humanlayer\/agentlayer-.+|@humanlayer\/codelayer)$/
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const
const FORBIDDEN_REFERENCE =
	/^(?:workspace:|file:|link:|git(?:\+|:)|https?:|ssh:)|(?:\.tgz(?:#.*)?$)|(?:^|\/)github\.com\//i

type DependencySection = (typeof DEPENDENCY_SECTIONS)[number]

type PackageManifest = {
	catalog?: Record<string, string>
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
	optionalDependencies?: Record<string, string>
	overrides?: Record<string, string>
	peerDependencies?: Record<string, string>
	resolutions?: Record<string, string>
	version?: string
}

type LockPackageEntry = [
	string,
	string,
	{ dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }?,
]

type LockWorkspaceEntry = Partial<Record<DependencySection, Record<string, string>>> & Record<string, unknown>

type BunLockfile = {
	packages?: Record<string, LockPackageEntry>
	workspaces?: Record<string, LockWorkspaceEntry>
	[key: string]: unknown
}

function fail(message: string): never {
	throw new Error(`AgentLayer release provenance check failed: ${message}`)
}

function parseArgs(args: string[]): { base?: string; version: string } {
	let base: string | undefined
	let version = DEFAULT_EXPECTED_VERSION
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index]
		if (argument !== '--base' && argument !== '--version') fail(`unknown argument ${argument ?? ''}`)
		const value = args[index + 1]
		if (!value || value.startsWith('--')) fail(`${argument} requires a value`)
		if (argument === '--base') base = value
		else version = value
		index += 1
	}
	if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`version ${version} is not an exact stable release`)
	return { base, version }
}

function assertSafeReference(packageName: string, reference: string, location: string, expectedVersion: string): void {
	if (FORBIDDEN_REFERENCE.test(reference) || reference.includes('#') || reference.includes('@github:')) {
		fail(`${location} uses forbidden reference for ${packageName}`)
	}
	if (reference !== 'catalog:' && reference !== expectedVersion) {
		fail(`${location} must reference ${packageName} through catalog: or ${expectedVersion}`)
	}
}

async function readJson<T>(path: string): Promise<T> {
	const file = Bun.file(path)
	if (!(await file.exists())) fail(`missing ${path}`)
	return (await file.json()) as T
}

function parseLockfile(contents: string, location: string): BunLockfile {
	try {
		return Bun.JSONC.parse(contents) as BunLockfile
	} catch {
		return fail(`could not parse ${location}`)
	}
}

async function readBaseLockfile(root: string, base: string): Promise<BunLockfile> {
	const process = Bun.spawn(['git', 'show', `${base}:bun.lock`], {
		cwd: root,
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const [exitCode, stdout] = await Promise.all([process.exited, new Response(process.stdout).text()])
	if (exitCode !== 0) fail(`could not read bun.lock from base ${base}`)
	return parseLockfile(stdout, `${base}:bun.lock`)
}

function stable(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
	if (value && typeof value === 'object') {
		return `{${Object.entries(value as Record<string, unknown>)
			.toSorted(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
			.join(',')}}`
	}
	return JSON.stringify(value)
}

function packageNameFromResolution(resolution: string): string {
	if (resolution.startsWith('@')) {
		const separator = resolution.indexOf('@', 1)
		return separator === -1 ? resolution : resolution.slice(0, separator)
	}
	const separator = resolution.lastIndexOf('@')
	return separator <= 0 ? resolution : resolution.slice(0, separator)
}

function dependencyClosureNames(lockfiles: BunLockfile[], roots: Set<string>): Set<string> {
	const dependenciesByName = new Map<string, Set<string>>()
	for (const lockfile of lockfiles) {
		for (const entry of Object.values(lockfile.packages ?? {})) {
			if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue
			const packageName = packageNameFromResolution(entry[0])
			const dependencies = dependenciesByName.get(packageName) ?? new Set<string>()
			for (const dependency of Object.keys(entry[2]?.dependencies ?? {})) dependencies.add(dependency)
			for (const dependency of Object.keys(entry[2]?.optionalDependencies ?? {})) dependencies.add(dependency)
			dependenciesByName.set(packageName, dependencies)
		}
	}

	const closure = new Set(roots)
	const pending = [...roots]
	while (pending.length > 0) {
		const packageName = pending.pop()!
		for (const dependency of dependenciesByName.get(packageName) ?? []) {
			if (closure.has(dependency)) continue
			closure.add(dependency)
			pending.push(dependency)
		}
	}
	return closure
}

function withoutAllowedWorkspaceDependencies(
	workspace: LockWorkspaceEntry | undefined,
	allowedPackages: Set<string>,
): LockWorkspaceEntry | undefined {
	if (!workspace) return undefined
	const copy = structuredClone(workspace)
	for (const section of DEPENDENCY_SECTIONS) {
		const dependencies = copy[section]
		if (!dependencies) continue
		for (const packageName of allowedPackages) delete dependencies[packageName]
	}
	return copy
}

function auditLockfileScope(
	base: BunLockfile,
	current: BunLockfile,
	releasePackages: string[],
): { changedPackages: number; changedWorkspaces: number } {
	const allowedRoots = new Set([...releasePackages, TOML_PACKAGE])
	const closure = dependencyClosureNames([base, current], allowedRoots)
	const packageKeys = new Set([...Object.keys(base.packages ?? {}), ...Object.keys(current.packages ?? {})])
	let changedPackages = 0
	for (const key of packageKeys) {
		const before = base.packages?.[key]
		const after = current.packages?.[key]
		if (stable(before) === stable(after)) continue
		changedPackages += 1
		const resolution = after?.[0] ?? before?.[0]
		if (typeof resolution !== 'string' || !closure.has(packageNameFromResolution(resolution))) {
			fail(`bun.lock package change ${key} is outside the allowed dependency closure`)
		}
	}

	const workspaceKeys = new Set([...Object.keys(base.workspaces ?? {}), ...Object.keys(current.workspaces ?? {})])
	let changedWorkspaces = 0
	for (const key of workspaceKeys) {
		const before = base.workspaces?.[key]
		const after = current.workspaces?.[key]
		if (stable(before) === stable(after)) continue
		changedWorkspaces += 1
		if (
			stable(withoutAllowedWorkspaceDependencies(before, allowedRoots)) !==
			stable(withoutAllowedWorkspaceDependencies(after, allowedRoots))
		) {
			fail(`bun.lock workspace change ${key} contains changes outside the allowed dependency roots`)
		}
	}

	const withoutDependencyMaps = (lockfile: BunLockfile) => {
		const copy = structuredClone(lockfile)
		delete copy.packages
		delete copy.workspaces
		if (copy.catalog && typeof copy.catalog === 'object' && !Array.isArray(copy.catalog)) {
			for (const packageName of allowedRoots) delete (copy.catalog as Record<string, unknown>)[packageName]
		}
		return copy
	}
	if (stable(withoutDependencyMaps(base)) !== stable(withoutDependencyMaps(current))) {
		fail('bun.lock metadata changed outside packages and workspaces')
	}
	return { changedPackages, changedWorkspaces }
}

const { base, version: expectedVersion } = parseArgs(Bun.argv.slice(2))
const root = process.cwd()
const rootManifest = await readJson<PackageManifest>(join(root, 'package.json'))
const releasePackages = Object.entries(rootManifest.catalog ?? {})
	.filter(([packageName]) => RELEASE_PACKAGE_PATTERN.test(packageName))
	.map(([packageName]) => packageName)
	.toSorted()
if (releasePackages.length === 0) fail('root package.json catalog contains no AgentLayer release packages')

for (const packageName of releasePackages) {
	const catalogVersion = rootManifest.catalog?.[packageName]
	if (catalogVersion !== expectedVersion) {
		fail(`root catalog ${packageName} is ${catalogVersion ?? 'missing'}, expected ${expectedVersion}`)
	}
	assertSafeReference(packageName, catalogVersion, 'root package.json catalog', expectedVersion)
	for (const overrideSection of ['overrides', 'resolutions'] as const) {
		const override = rootManifest[overrideSection]?.[packageName]
		if (override !== undefined) {
			assertSafeReference(packageName, override, `root package.json ${overrideSection}`, expectedVersion)
		}
	}
}

const manifestGlob = new Bun.Glob('{apps,contracts,packages,vendor}/*/package.json')
const installationRoots = new Map<string, string[]>()
for await (const relativePath of manifestGlob.scan({ cwd: root, onlyFiles: true })) {
	const manifest = await readJson<PackageManifest>(join(root, relativePath))
	for (const section of DEPENDENCY_SECTIONS) {
		for (const packageName of releasePackages) {
			const reference = manifest[section]?.[packageName]
			if (reference !== undefined) {
				assertSafeReference(packageName, reference, `${relativePath} ${section}`, expectedVersion)
				const roots = installationRoots.get(packageName) ?? []
				roots.push(dirname(relativePath))
				installationRoots.set(packageName, roots)
			}
		}
	}
}

const lockText = await Bun.file(join(root, 'bun.lock')).text()
const lock = parseLockfile(lockText, 'bun.lock')
for (const packageName of releasePackages) {
	const entry = lock.packages?.[packageName]
	if (!Array.isArray(entry)) fail(`bun.lock has no package entry for ${packageName}`)
	if (entry[0] !== `${packageName}@${expectedVersion}` || entry[1] !== '') {
		fail(`bun.lock ${packageName} is not an exact registry resolution at ${expectedVersion}`)
	}

	const packageInstallationRoots = installationRoots.get(packageName) ?? []
	if (packageInstallationRoots.length === 0) fail(`no workspace manifest consumes ${packageName}`)
	for (const installationRoot of new Set(packageInstallationRoots)) {
		const installedManifest = await readJson<PackageManifest>(
			join(root, installationRoot, 'node_modules', packageName, 'package.json'),
		)
		if (installedManifest.version !== expectedVersion) {
			fail(
				`installed ${packageName} under ${installationRoot} is ${installedManifest.version ?? 'missing'}, expected ${expectedVersion}`,
			)
		}
	}
}

let scopeMessage = ''
if (base) {
	const baseLock = await readBaseLockfile(root, base)
	const scope = auditLockfileScope(baseLock, lock, releasePackages)
	scopeMessage = `; audited ${scope.changedPackages} package and ${scope.changedWorkspaces} workspace lock changes from ${base}`
}

console.log(`Verified ${releasePackages.length} registry AgentLayer packages at ${expectedVersion}${scopeMessage}`)

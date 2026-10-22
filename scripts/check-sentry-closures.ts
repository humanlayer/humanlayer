import { realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const expectedVersion = '10.70.0'
const repoRoot = join(import.meta.dirname, '..')

type Deployable = {
	readonly name: string
	readonly packageDirectory: string
	readonly sentryPackages: ReadonlyArray<string>
}

const deployables: ReadonlyArray<Deployable> = [
	{
		name: 'riptide-api',
		packageDirectory: join(repoRoot, 'apps/riptide-api'),
		sentryPackages: ['@sentry/core', '@sentry/effect', '@sentry/node'],
	},
	{
		name: 'riptide-daemon',
		packageDirectory: join(repoRoot, 'apps/riptide-daemon'),
		sentryPackages: ['@sentry/bun', '@sentry/core', '@sentry/effect', '@sentry/node'],
	},
]

const packageVersion = async (packageJsonPath: string): Promise<string> => {
	const packageJson: unknown = await Bun.file(packageJsonPath).json()
	if (typeof packageJson !== 'object' || packageJson === null || !('version' in packageJson)) {
		throw new Error(`Package manifest has no version: ${packageJsonPath}`)
	}
	const version = packageJson.version
	if (typeof version !== 'string') throw new Error(`Package manifest version is not a string: ${packageJsonPath}`)
	return version
}

const assertDeclaredSentryFamilyResolution = async (deployable: Deployable): Promise<void> => {
	const rootRequire = createRequire(join(deployable.packageDirectory, 'package.json'))
	const coreInstallations = new Set<string>()

	for (const packageName of deployable.sentryPackages) {
		const packageJsonPath = rootRequire.resolve(`${packageName}/package.json`)
		const version = await packageVersion(packageJsonPath)
		if (version !== expectedVersion) {
			throw new Error(`${deployable.name} resolves ${packageName}@${version}; expected ${expectedVersion}`)
		}

		const packageRequire = createRequire(packageJsonPath)
		const corePackageJsonPath = packageRequire.resolve('@sentry/core/package.json')
		coreInstallations.add(await realpath(corePackageJsonPath))
		const coreVersion = await packageVersion(corePackageJsonPath)
		if (coreVersion !== expectedVersion) {
			throw new Error(`${packageName} in ${deployable.name} resolves @sentry/core@${coreVersion}`)
		}
	}

	if (coreInstallations.size !== 1) {
		throw new Error(
			`${deployable.name} resolves ${coreInstallations.size} @sentry/core carriers:\n${[...coreInstallations].join('\n')}`,
		)
	}
}

const sentryCoreVersions = (inputs: ReadonlyArray<string>): ReadonlySet<string> => {
	const versions = new Set<string>()
	for (const input of inputs) {
		const match = input.match(/@sentry\+core@([^/]+)\/node_modules\/@sentry\/core\//)
		if (match?.[1]) versions.add(match[1])
	}
	return versions
}

const buildMetafile = async (options: Bun.BuildConfig) => {
	const result = await Bun.build({ ...options, metafile: true, write: false })
	if (!result.success) {
		throw new AggregateError(result.logs, 'Sentry closure guard build failed')
	}
	if (!result.metafile) throw new Error('Bun did not return a build metafile')
	return result.metafile
}

const assertInMemoryBuildModel = async (): Promise<void> => {
	const daemonMetafile = await buildMetafile({
		entrypoints: [join(repoRoot, 'apps/riptide-daemon/src/daemon.ts')],
		target: 'bun',
	})
	const daemonVersions = sentryCoreVersions(Object.keys(daemonMetafile.inputs))
	if (daemonVersions.size !== 1 || !daemonVersions.has(expectedVersion)) {
		throw new Error(`riptide-daemon bundle has @sentry/core versions: ${[...daemonVersions].join(', ') || 'none'}`)
	}

	const apiMetafile = await buildMetafile({
		entrypoints: [
			join(repoRoot, 'apps/riptide-api/src/index.ts'),
			join(repoRoot, 'apps/riptide-api/src/instrument.mts'),
		],
		external: ['@sentry/core', '@sentry/node'],
		format: 'esm',
		target: 'node',
	})
	const apiVersions = sentryCoreVersions(Object.keys(apiMetafile.inputs))
	if (apiVersions.size > 0) {
		throw new Error(`riptide-api unexpectedly bundled @sentry/core versions: ${[...apiVersions].join(', ')}`)
	}
	const apiExternalImports = Object.values(apiMetafile.inputs).flatMap((input) =>
		input.imports.filter((entry) => entry.external).map((entry) => entry.path),
	)
	if (!apiExternalImports.includes('@sentry/core') || !apiExternalImports.includes('@sentry/node')) {
		throw new Error('riptide-api build no longer externalizes both @sentry/core and @sentry/node')
	}
}

await Promise.all(deployables.map(assertDeclaredSentryFamilyResolution))
await assertInMemoryBuildModel()

console.log(
	'Sentry guard passed: declared API/daemon Sentry families resolve one core installation; the in-memory daemon bundle contains only core@10.70.0; the in-memory API build externalizes core/node',
)

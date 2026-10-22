import { createHash } from 'node:crypto'
import { lstat, mkdtemp, mkdir, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { mockLogger, mockCaptureException } = vi.hoisted(() => ({
	mockLogger: {
		info: vi.fn(),
		error: vi.fn(),
	},
	mockCaptureException: vi.fn(),
}))

vi.mock('@/logger', () => ({ default: mockLogger }))
vi.mock('@/instrument', () => ({ Sentry: { captureException: mockCaptureException } }))

const { discoverBundledRpiSkills, discoverCodexSkills } =
	await import('../../../../src/agents/codelayer/codex-skill-discovery')

let fixtureRoot: string

async function directory(path: string): Promise<string> {
	await mkdir(path, { recursive: true })
	return path
}

async function skill(root: string, relativeDirectory: string, name: string, marker = name): Promise<string> {
	const skillDirectory = await directory(join(root, relativeDirectory))
	const path = join(skillDirectory, 'SKILL.md')
	await writeFile(path, `---\nname: ${name}\ndescription: ${name} description\n---\n# ${marker}\n`, 'utf8')
	return path
}

async function pluginBundle(
	codexHome: string,
	marketplace: string,
	plugin: string,
	version: string,
	options: { manifestDirectory?: '.codex-plugin' | '.claude-plugin'; skills?: string | string[] } = {},
): Promise<string> {
	const root = await directory(join(codexHome, 'plugins', 'cache', marketplace, plugin, version))
	const manifestDirectory = await directory(join(root, options.manifestDirectory ?? '.codex-plugin'))
	await writeFile(
		join(manifestDirectory, 'plugin.json'),
		JSON.stringify({ name: plugin, ...(options.skills === undefined ? {} : { skills: options.skills }) }),
	)
	return root
}

interface SnapshotEntry {
	path: string
	type: 'directory' | 'file' | 'symlink' | 'other'
	mode: number
	size: number
	hash?: string
	target?: string
}

async function filesystemSnapshot(paths: string[]): Promise<Array<SnapshotEntry | { path: string; type: 'absent' }>> {
	const snapshot: Array<SnapshotEntry | { path: string; type: 'absent' }> = []

	async function visit(path: string): Promise<void> {
		let details
		try {
			details = await lstat(path)
		} catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
				snapshot.push({ path, type: 'absent' })
				return
			}
			throw error
		}
		const common = { path, mode: details.mode, size: details.size }
		if (details.isSymbolicLink()) {
			snapshot.push({ ...common, type: 'symlink', target: await readlink(path) })
			return
		}
		if (details.isFile()) {
			const hash = createHash('sha256')
				.update(await readFile(path))
				.digest('hex')
			snapshot.push({ ...common, type: 'file', hash })
			return
		}
		if (!details.isDirectory()) {
			snapshot.push({ ...common, type: 'other' })
			return
		}
		snapshot.push({ ...common, type: 'directory' })
		for (const entry of (await readdir(path)).toSorted()) await visit(join(path, entry))
	}

	for (const path of paths) await visit(path)
	return snapshot
}

function token(kind: 'plugin' | 'version' | 'path', value: string): string {
	return `${kind}-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`
}

async function expectReadOnly<T>(paths: string[], run: () => Promise<T>): Promise<T> {
	const before = await filesystemSnapshot(paths)
	const result = await run()
	expect(await filesystemSnapshot(paths)).toEqual(before)
	return result
}

function project(result: Awaited<ReturnType<typeof discoverCodexSkills>>) {
	return result.skills.map((entry) => ({
		name: entry.name,
		baseDir: entry.baseDir,
		sourceKind: entry.source.kind,
		sourceRoot: entry.source.root,
		projectDirectory: entry.source.projectDirectory,
		configuredRoot: entry.source.configuredRoot,
	}))
}

function capturedPayloads(): string {
	return JSON.stringify(
		{
			loggerError: mockLogger.error.mock.calls,
			loggerInfo: mockLogger.info.mock.calls,
			sentry: mockCaptureException.mock.calls,
		},
		(_key, value) => (value instanceof Error ? { name: value.name, message: value.message } : value),
	)
}

function expectNoSentinel(value: unknown, sentinel: string): void {
	if (typeof value === 'string') {
		expect(value).not.toContain(sentinel)
		return
	}
	if (value instanceof Error) {
		expectNoSentinel(value.name, sentinel)
		expectNoSentinel(value.message, sentinel)
		expectNoSentinel(value.cause, sentinel)
		return
	}
	if (Array.isArray(value)) {
		for (const entry of value) expectNoSentinel(entry, sentinel)
		return
	}
	if (value && typeof value === 'object') {
		for (const [key, entry] of Object.entries(value)) {
			expectNoSentinel(key, sentinel)
			expectNoSentinel(entry, sentinel)
		}
	}
}

function expectBoundaryPayloadsExclude(
	sentinel: string,
	diagnostics: Awaited<ReturnType<typeof discoverCodexSkills>>['diagnostics'],
): void {
	expectNoSentinel(mockLogger.info.mock.calls, sentinel)
	expectNoSentinel(mockLogger.error.mock.calls, sentinel)
	expectNoSentinel(mockCaptureException.mock.calls, sentinel)
	expectNoSentinel(diagnostics, sentinel)
}

describe('discoverCodexSkills', () => {
	beforeEach(async () => {
		fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'riptide-codex-skills-')))
		mockLogger.info.mockClear()
		mockLogger.error.mockClear()
		mockCaptureException.mockClear()
	})

	afterEach(async () => {
		vi.unstubAllEnvs()
		await rm(fixtureRoot, { recursive: true, force: true })
	})

	test('returns one exact canonical catalog in source and collision order', async () => {
		const home = await directory(join(fixtureRoot, 'home'))
		const codexHome = await directory(join(fixtureRoot, 'custom-codex'))
		const repo = await directory(join(fixtureRoot, 'repo'))
		const apps = await directory(join(repo, 'apps'))
		const cwd = await directory(join(apps, 'api'))
		const bundled = await directory(join(fixtureRoot, 'bundled', 'skills'))
		const configuredA = await directory(join(fixtureRoot, 'configured-a'))
		const configuredB = await directory(join(fixtureRoot, 'configured-b'))

		await writeFile(join(codexHome, 'config.toml'), 'project_root_markers = ["project.marker"]\n')
		await writeFile(join(repo, 'project.marker'), '')

		const bundledPlan = await skill(bundled, 'plan', 'plan', 'bundled winner')
		const cwdCodexShared = await skill(join(cwd, '.codex', 'skills'), 'nested/shared', 'shared', 'cwd codex winner')
		const cwdAgents = await skill(join(cwd, '.agents', 'skills'), 'agent-only', 'agent-only')
		await skill(join(cwd, '.agents', 'skills'), 'shared', 'shared', 'losing agents marker')
		await skill(join(cwd, '.claude', 'skills'), 'shared', 'shared', 'losing claude marker')
		await skill(join(cwd, '.claude', 'skills'), 'rpi-collision', 'rpi:plan', 'losing bundled marker')
		const appsSkill = await skill(join(apps, '.codex', 'skills'), 'ancestor', 'ancestor')
		const rootSkill = await skill(join(repo, '.claude', 'skills'), 'root-only', 'root-only')

		const configuredShared = await skill(join(configuredA, '.codex', 'skills'), 'shared', 'configured-shared')
		await skill(join(configuredB, '.codex', 'skills'), 'shared', 'configured-shared', 'losing configured marker')
		const configuredUnique = await skill(join(configuredB, '.agents', 'skills'), 'unique', 'configured-unique')
		await directory(join(configuredA, '.agents'))
		await symlink(join(cwd, '.codex', 'skills'), join(configuredA, '.agents', 'skills'))

		const userCodex = await skill(join(codexHome, 'skills'), 'user-codex', 'user-codex')
		await skill(join(codexHome, 'skills', '.system'), 'hidden-system', 'hidden-system')
		const userAgents = await skill(join(home, '.agents', 'skills'), 'user-agents', 'user-agents')
		const userClaude = await skill(join(home, '.claude', 'skills'), 'user-claude', 'user-claude')
		await writeFile(join(cwd, '.codex', 'skills', 'not-exact.md'), '---\nname: ignored\n---\n')

		const aliasDirectory = await directory(join(cwd, '.codex', 'skills', 'zz-alias'))
		await symlink(cwdCodexShared, join(aliasDirectory, 'SKILL.md'))

		const result = await discoverCodexSkills({
			cwd,
			home,
			codexHome,
			bundledRpiRoot: bundled,
			configuredRepoRoots: [configuredA, configuredB],
		})

		expect(project(result)).toEqual([
			{
				name: 'rpi:plan',
				baseDir: join(bundled, 'plan'),
				sourceKind: 'bundled',
				sourceRoot: bundled,
				projectDirectory: undefined,
				configuredRoot: undefined,
			},
			{
				name: 'shared',
				baseDir: join(cwd, '.codex', 'skills', 'nested', 'shared'),
				sourceKind: 'project',
				sourceRoot: join(cwd, '.codex', 'skills'),
				projectDirectory: cwd,
				configuredRoot: undefined,
			},
			{
				name: 'agent-only',
				baseDir: join(cwd, '.agents', 'skills', 'agent-only'),
				sourceKind: 'project',
				sourceRoot: join(cwd, '.agents', 'skills'),
				projectDirectory: cwd,
				configuredRoot: undefined,
			},
			{
				name: 'ancestor',
				baseDir: join(apps, '.codex', 'skills', 'ancestor'),
				sourceKind: 'project',
				sourceRoot: join(apps, '.codex', 'skills'),
				projectDirectory: apps,
				configuredRoot: undefined,
			},
			{
				name: 'root-only',
				baseDir: join(repo, '.claude', 'skills', 'root-only'),
				sourceKind: 'project',
				sourceRoot: join(repo, '.claude', 'skills'),
				projectDirectory: repo,
				configuredRoot: undefined,
			},
			{
				name: 'configured-shared',
				baseDir: join(configuredA, '.codex', 'skills', 'shared'),
				sourceKind: 'configured',
				sourceRoot: join(configuredA, '.codex', 'skills'),
				projectDirectory: undefined,
				configuredRoot: configuredA,
			},
			{
				name: 'configured-unique',
				baseDir: join(configuredB, '.agents', 'skills', 'unique'),
				sourceKind: 'configured',
				sourceRoot: join(configuredB, '.agents', 'skills'),
				projectDirectory: undefined,
				configuredRoot: configuredB,
			},
			{
				name: 'user-codex',
				baseDir: join(codexHome, 'skills', 'user-codex'),
				sourceKind: 'user',
				sourceRoot: join(codexHome, 'skills'),
				projectDirectory: undefined,
				configuredRoot: undefined,
			},
			{
				name: 'user-agents',
				baseDir: join(home, '.agents', 'skills', 'user-agents'),
				sourceKind: 'user',
				sourceRoot: join(home, '.agents', 'skills'),
				projectDirectory: undefined,
				configuredRoot: undefined,
			},
			{
				name: 'user-claude',
				baseDir: join(home, '.claude', 'skills', 'user-claude'),
				sourceKind: 'user',
				sourceRoot: join(home, '.claude', 'skills'),
				projectDirectory: undefined,
				configuredRoot: undefined,
			},
		])
		expect(result.skills.map((entry) => entry.content).join('\n')).not.toContain('losing')
		expect(result.skills.map((entry) => entry.name)).not.toContain('hidden-system')
		expect(result.skills.map((entry) => entry.name)).not.toContain('ignored')
		expect(result.skills[0]?.skillFile).toBe(bundledPlan)
		expect(result.skills.find((entry) => entry.name === 'configured-shared')?.skillFile).toBe(configuredShared)
		expect(result.skills.find((entry) => entry.name === 'configured-unique')?.skillFile).toBe(configuredUnique)
		expect(result.skills.find((entry) => entry.name === 'user-codex')?.skillFile).toBe(userCodex)
		expect(result.skills.find((entry) => entry.name === 'user-agents')?.skillFile).toBe(userAgents)
		expect(result.skills.find((entry) => entry.name === 'user-claude')?.skillFile).toBe(userClaude)
		expect(result.skills.find((entry) => entry.name === 'ancestor')?.skillFile).toBe(appsSkill)
		expect(result.skills.find((entry) => entry.name === 'root-only')?.skillFile).toBe(rootSkill)
		expect(result.diagnostics).toEqual([])
		expect(result.summary).toMatchObject({
			diagnosticCount: 0,
			errors: 0,
			found: 31,
			loaded: 11,
			skipped: 7,
		})
		expect(mockCaptureException).not.toHaveBeenCalled()

		const outcomes = mockLogger.info.mock.calls.map(([event]) => event.outcome)
		const boundaryOutcomes = mockLogger.info.mock.calls
			.map(([event]) => event)
			.filter(
				(event) =>
					!((event.outcome === 'checked' || event.outcome === 'missing') && event.sourceKind === 'project'),
			)
			.map((event) => `${event.stage}:${event.sourceKind ?? 'all'}:${event.outcome}`)
		expect(boundaryOutcomes).toMatchInlineSnapshot(`
			[
			  "config:config:checked",
			  "config:config:found",
			  "config:config:loaded",
			  "root:configured:checked",
			  "root:configured:found",
			  "root:configured:checked",
			  "root:configured:found",
			  "root:bundled:checked",
			  "root:bundled:found",
			  "file:bundled:checked",
			  "file:bundled:found",
			  "file:bundled:loaded",
			  "root:project:found",
			  "file:project:found",
			  "file:project:loaded",
			  "file:project:found",
			  "file:project:deduplicated",
			  "root:project:found",
			  "file:project:found",
			  "file:project:loaded",
			  "file:project:found",
			  "file:project:collision",
			  "root:project:found",
			  "file:project:found",
			  "file:project:collision",
			  "file:project:found",
			  "file:project:collision",
			  "root:project:found",
			  "file:project:found",
			  "file:project:loaded",
			  "root:project:found",
			  "file:project:found",
			  "file:project:loaded",
			  "root:configured:checked",
			  "root:configured:found",
			  "file:configured:checked",
			  "file:configured:found",
			  "file:configured:loaded",
			  "root:configured:checked",
			  "root:configured:found",
			  "root:configured:deduplicated",
			  "root:configured:checked",
			  "root:configured:missing",
			  "root:configured:checked",
			  "root:configured:found",
			  "file:configured:checked",
			  "file:configured:found",
			  "file:configured:collision",
			  "root:configured:checked",
			  "root:configured:found",
			  "file:configured:checked",
			  "file:configured:found",
			  "file:configured:loaded",
			  "root:configured:checked",
			  "root:configured:missing",
			  "root:user:checked",
			  "root:user:found",
			  "root:user:excluded",
			  "file:user:checked",
			  "file:user:found",
			  "file:user:loaded",
			  "root:user:checked",
			  "root:user:found",
			  "file:user:checked",
			  "file:user:found",
			  "file:user:loaded",
			  "root:user:checked",
			  "root:user:found",
			  "file:user:checked",
			  "file:user:found",
			  "file:user:loaded",
			  "summary:all:complete",
			]
		`)
		expect(outcomes).toContain('checked')
		expect(outcomes).toContain('found')
		expect(outcomes).toContain('missing')
		expect(outcomes).toContain('loaded')
		expect(outcomes).toContain('excluded')
		expect(outcomes).toContain('deduplicated')
		expect(outcomes).toContain('collision')
		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.objectContaining({
				discovery: 'codex-skills',
				stage: 'summary',
				outcome: 'complete',
				summary: result.summary,
			}),
			'Codex skill discovery complete',
		)
	})

	test('loads built-in HumanLayer skills under the hl namespace', async () => {
		const home = await directory(join(fixtureRoot, 'home'))
		const codexHome = await directory(join(fixtureRoot, 'codex-home'))
		const cwd = await directory(join(fixtureRoot, 'repo'))
		const bundledRpiRoot = await directory(join(fixtureRoot, 'rpi', 'skills'))
		const bundledHumanlayerRoot = await directory(join(fixtureRoot, 'humanlayer', 'skills'))
		await skill(bundledHumanlayerRoot, 'show-me', 'show-me', 'visual guidance')

		const result = await discoverCodexSkills({
			cwd,
			home,
			codexHome,
			bundledRpiRoot,
			bundledHumanlayerRoot,
			configuredRepoRoots: [],
		})

		expect(result.skills.map(({ name }) => name)).toContain('hl:show-me')
	})

	test('never exposes valid TOML marker payloads through observability boundaries', async () => {
		const secretMarker = 'VALID_TOML_SECRET_5f31'
		const home = await directory(join(fixtureRoot, 'home'))
		const codexHome = await directory(join(fixtureRoot, 'codex'))
		const cwd = await directory(join(fixtureRoot, 'repo', 'cwd'))
		const bundled = await directory(join(fixtureRoot, 'bundled'))
		await writeFile(join(codexHome, 'config.toml'), `project_root_markers = ["${secretMarker}"]\n`)
		await writeFile(join(cwd, secretMarker), '')
		await skill(join(cwd, '.agents', 'skills'), 'healthy', 'healthy')

		const result = await discoverCodexSkills({
			cwd,
			home,
			codexHome,
			bundledRpiRoot: bundled,
			configuredRepoRoots: [],
		})

		expect(result.skills.map((entry) => entry.name)).toEqual(['healthy'])
		expectBoundaryPayloadsExclude(secretMarker, result.diagnostics)
	})

	test('never exposes valid frontmatter payloads through observability boundaries', async () => {
		const secretName = 'VALID_FRONTMATTER_NAME_SECRET_7ca2'
		const secretDescription = 'VALID_FRONTMATTER_DESCRIPTION_SECRET_b614'
		const home = await directory(join(fixtureRoot, 'home'))
		const codexHome = await directory(join(fixtureRoot, 'codex'))
		const cwd = await directory(join(fixtureRoot, 'cwd'))
		const bundled = await directory(join(fixtureRoot, 'bundled'))
		await directory(join(cwd, '.git'))
		const skillDirectory = await directory(join(cwd, '.codex', 'skills', 'secret'))
		await writeFile(
			join(skillDirectory, 'SKILL.md'),
			`---\nname: ${secretName}\ndescription: ${secretDescription}\n---\n# private body\n`,
		)

		const result = await discoverCodexSkills({
			cwd,
			home,
			codexHome,
			bundledRpiRoot: bundled,
			configuredRepoRoots: [],
		})

		expect(result.skills.map((entry) => entry.name)).toEqual([secretName])
		expectBoundaryPayloadsExclude(secretName, result.diagnostics)
		expectBoundaryPayloadsExclude(secretDescription, result.diagnostics)
	})

	test('bundled-only discovery returns canonical sources and exact error accounting', async () => {
		const bundled = await directory(join(fixtureRoot, 'bundled', 'skills'))
		const bundledAlias = join(fixtureRoot, 'bundled-alias')
		await symlink(bundled, bundledAlias)
		await writeFile(
			join(await directory(join(bundled, 'broken')), 'SKILL.md'),
			'---\nname: broken\n---\n# missing description\n',
		)
		await skill(bundled, 'healthy', 'healthy')

		const result = await discoverBundledRpiSkills(bundledAlias)

		expect(result.skills.map((entry) => entry.name)).toEqual(['rpi:healthy'])
		expect(result.sources).toEqual([{ kind: 'bundled', root: bundled }])
		expect(result.diagnostics).toEqual([
			{
				stage: 'file',
				sourceKind: 'bundled',
				path: join(bundled, 'broken', 'SKILL.md'),
				code: 'frontmatter_validation_failed',
				message: 'Skill frontmatter is missing required fields',
			},
		])
		expect(result.summary).toEqual({
			checked: 3,
			found: 3,
			missing: 0,
			loaded: 1,
			skipped: 0,
			errors: 1,
			diagnosticCount: 1,
		})
		expect(mockCaptureException).not.toHaveBeenCalled()
	})

	test('canonicalizes a symlinked cwd before physical ancestor discovery and source metadata', async () => {
		const home = await directory(join(fixtureRoot, 'home'))
		const codexHome = await directory(join(fixtureRoot, 'codex'))
		const physicalRepo = await directory(join(fixtureRoot, 'physical-repo'))
		const physicalCwd = await directory(join(physicalRepo, 'apps', 'api'))
		const aliasRepo = join(fixtureRoot, 'repo-alias')
		const bundled = await directory(join(fixtureRoot, 'bundled'))
		await directory(join(physicalRepo, '.git'))
		await symlink(physicalRepo, aliasRepo)
		await skill(join(physicalRepo, '.codex', 'skills'), 'physical', 'physical')

		const result = await discoverCodexSkills({
			cwd: join(aliasRepo, 'apps', 'api'),
			home,
			codexHome,
			bundledRpiRoot: bundled,
			configuredRepoRoots: [],
		})

		expect(result.skills).toEqual([
			expect.objectContaining({
				name: 'physical',
				source: expect.objectContaining({
					root: join(physicalRepo, '.codex', 'skills'),
					projectDirectory: physicalRepo,
				}),
			}),
		])
		expect(result.skills[0]?.baseDir).toBe(join(physicalRepo, '.codex', 'skills', 'physical'))
		expect(physicalCwd).toBe(join(physicalRepo, 'apps', 'api'))
	})

	test('canonicalizes configured repository aliases while retaining input precedence', async () => {
		const home = await directory(join(fixtureRoot, 'home'))
		const codexHome = await directory(join(fixtureRoot, 'codex'))
		const cwd = await directory(join(fixtureRoot, 'cwd'))
		const bundled = await directory(join(fixtureRoot, 'bundled'))
		const configuredA = await directory(join(fixtureRoot, 'configured-a'))
		const configuredB = await directory(join(fixtureRoot, 'configured-b'))
		const configuredBAlias = join(fixtureRoot, 'configured-b-alias')
		await symlink(configuredB, configuredBAlias)
		await skill(join(configuredA, '.codex', 'skills'), 'shared', 'shared', 'second input')
		await skill(join(configuredB, '.codex', 'skills'), 'shared', 'shared', 'first input')
		await skill(join(configuredA, '.agents', 'skills'), 'unique-a', 'unique-a')

		const result = await discoverCodexSkills({
			cwd,
			home,
			codexHome,
			bundledRpiRoot: bundled,
			configuredRepoRoots: [configuredBAlias, configuredA],
		})

		expect(result.skills.map((entry) => entry.name)).toEqual(['shared', 'unique-a'])
		expect(result.skills[0]?.content).toContain('first input')
		expect(result.skills[0]?.source.configuredRoot).toBe(configuredB)
		expect(result.skills[1]?.source.configuredRoot).toBe(configuredA)
	})

	test('walks every ancestor regardless of project markers', async () => {
		const home = await directory(join(fixtureRoot, 'home'))
		const codexHome = await directory(join(fixtureRoot, 'codex'))
		const repo = await directory(join(fixtureRoot, 'repo'))
		const nestedRoot = await directory(join(repo, 'nested'))
		const cwd = await directory(join(nestedRoot, 'api'))
		const bundled = await directory(join(fixtureRoot, 'bundled'))
		await directory(join(repo, '.git'))
		await directory(join(nestedRoot, '.git'))
		await skill(join(repo, '.codex', 'skills'), 'too-far', 'too-far')
		await skill(join(nestedRoot, '.codex', 'skills'), 'nearest', 'nearest')

		const marked = await discoverCodexSkills({
			cwd,
			home,
			codexHome,
			bundledRpiRoot: bundled,
			configuredRepoRoots: [],
		})
		expect(marked.skills.map((entry) => entry.name)).toEqual(['nearest', 'too-far'])

		await rm(join(nestedRoot, '.git'), { recursive: true })
		await rm(join(repo, '.git'), { recursive: true })
		await skill(join(cwd, '.agents', 'skills'), 'cwd-only', 'cwd-only')
		const unmarked = await discoverCodexSkills({
			cwd,
			home,
			codexHome,
			bundledRpiRoot: bundled,
			configuredRepoRoots: [],
		})
		expect(unmarked.skills.map((entry) => entry.name)).toEqual(['cwd-only', 'nearest', 'too-far'])
	})

	test('derives default and custom Codex homes only at the public environment boundary', async () => {
		const originalHome = process.env.HOME
		const originalCodexHome = process.env.CODEX_HOME
		const home = await directory(join(fixtureRoot, 'home'))
		const defaultCodexHome = await directory(join(home, '.codex'))
		const customCodexHome = await directory(join(fixtureRoot, 'custom-codex'))
		const cwd = await directory(join(fixtureRoot, 'cwd'))
		const bundled = await directory(join(fixtureRoot, 'bundled'))
		await skill(join(defaultCodexHome, 'skills'), 'default', 'default-home')
		await skill(join(customCodexHome, 'skills'), 'custom', 'custom-home')

		try {
			vi.stubEnv('HOME', home)
			vi.stubEnv('CODEX_HOME', '')
			const fromDefault = await discoverCodexSkills({ cwd, bundledRpiRoot: bundled, configuredRepoRoots: [] })
			expect(fromDefault.skills.map((entry) => entry.name)).toEqual(['default-home'])
			expect(fromDefault.summary.diagnosticCount).toBe(0)

			vi.stubEnv('CODEX_HOME', customCodexHome)
			const fromCustom = await discoverCodexSkills({ cwd, bundledRpiRoot: bundled, configuredRepoRoots: [] })
			expect(fromCustom.skills.map((entry) => entry.name)).toEqual(['custom-home'])
		} finally {
			vi.unstubAllEnvs()
		}
		expect(process.env.HOME).toBe(originalHome)
		expect(process.env.CODEX_HOME).toBe(originalCodexHome)
	})

	test('scrubs malformed config contents from diagnostics, logs, and Sentry while continuing', async () => {
		const secretMarker = 'TOML_SECRET_MARKER_94f1'
		const home = await directory(join(fixtureRoot, 'home'))
		const codexHome = await directory(join(fixtureRoot, 'codex'))
		const repo = await directory(join(fixtureRoot, 'repo'))
		const cwd = await directory(join(repo, 'cwd'))
		const bundled = await directory(join(fixtureRoot, 'bundled'))
		await directory(join(repo, '.git'))
		const configPath = join(codexHome, 'config.toml')
		await writeFile(configPath, `project_root_markers = ["${secretMarker}"`)
		await skill(join(repo, '.agents', 'skills'), 'healthy', 'healthy')
		const marketplaceRoot = await directory(join(fixtureRoot, 'config-failure-marketplace'))
		await writeFile(join(marketplaceRoot, 'marketplace.json'), '{"plugins":[]}')
		const watchedPaths = [
			fixtureRoot,
			configPath,
			marketplaceRoot,
			join(codexHome, 'plugins', 'cache'),
			join(codexHome, 'plugins', 'data'),
			join(codexHome, 'skills'),
		]

		const result = await expectReadOnly(watchedPaths, () =>
			discoverCodexSkills({
				cwd,
				home,
				codexHome,
				bundledRpiRoot: bundled,
				configuredRepoRoots: [],
			}),
		)

		expect(result.skills.map((entry) => entry.name)).toEqual(['healthy'])
		expect(result.diagnostics).toEqual([
			{
				stage: 'config',
				sourceKind: 'config',
				path: join(codexHome, 'config.toml'),
				code: 'config_parse_failed',
				message: 'Codex config could not be parsed',
			},
		])
		expect(result.summary).toEqual(expect.objectContaining({ errors: 1, diagnosticCount: 1, loaded: 1 }))
		expect(mockLogger.error).toHaveBeenCalledTimes(1)
		expect(mockCaptureException).toHaveBeenCalledTimes(0)
		expect(capturedPayloads()).not.toContain(secretMarker)
		expect(JSON.stringify(result.diagnostics)).not.toContain(secretMarker)
	})

	test('scrubs malformed YAML and rejects missing frontmatter fields without stopping healthy skills', async () => {
		const secretMarker = 'YAML_SECRET_MARKER_82aa'
		const home = await directory(join(fixtureRoot, 'home'))
		const codexHome = await directory(join(fixtureRoot, 'codex'))
		const cwd = await directory(join(fixtureRoot, 'cwd'))
		const bundled = await directory(join(fixtureRoot, 'bundled'))
		const skillsRoot = await directory(join(cwd, '.codex', 'skills'))
		await writeFile(
			join(await directory(join(skillsRoot, 'malformed')), 'SKILL.md'),
			`---\nname: [${secretMarker}\ndescription: hidden\n---\n`,
		)
		await writeFile(
			join(await directory(join(skillsRoot, 'missing-name')), 'SKILL.md'),
			'---\ndescription: present\n---\n',
		)
		await writeFile(
			join(await directory(join(skillsRoot, 'missing-description')), 'SKILL.md'),
			'---\nname: present\n---\n',
		)
		await skill(skillsRoot, 'healthy', 'healthy')

		const result = await discoverCodexSkills({
			cwd,
			home,
			codexHome,
			bundledRpiRoot: bundled,
			configuredRepoRoots: [],
		})

		expect(result.skills.map((entry) => entry.name)).toEqual(['healthy'])
		expect(result.diagnostics.map((diagnostic) => diagnostic.code).toSorted()).toEqual([
			'frontmatter_parse_failed',
			'frontmatter_validation_failed',
			'frontmatter_validation_failed',
		])
		expect(result.summary).toEqual(expect.objectContaining({ errors: 3, diagnosticCount: 3, loaded: 1 }))
		expect(mockLogger.error).toHaveBeenCalledTimes(3)
		expect(mockCaptureException).toHaveBeenCalledTimes(0)
		expect(capturedPayloads()).not.toContain(secretMarker)
		expect(JSON.stringify(result.diagnostics)).not.toContain(secretMarker)
	})

	test('classifies portable config I/O and cwd canonicalization failures with safe diagnostics', async () => {
		const home = await directory(join(fixtureRoot, 'home'))
		const codexHome = await directory(join(fixtureRoot, 'codex'))
		const bundled = await directory(join(fixtureRoot, 'bundled'))
		await directory(join(codexHome, 'config.toml'))
		await skill(bundled, 'healthy', 'healthy')

		const result = await discoverCodexSkills({
			cwd: join(fixtureRoot, 'missing-cwd'),
			home,
			codexHome,
			bundledRpiRoot: bundled,
			configuredRepoRoots: [],
		})

		expect(result.skills.map((entry) => entry.name)).toEqual(['rpi:healthy'])
		expect(result.diagnostics.map((diagnostic) => diagnostic.code).toSorted()).toEqual([
			'config_read_failed',
			'cwd_canonicalization_failed',
		])
		expect(result.summary).toEqual(expect.objectContaining({ errors: 2, diagnosticCount: 2, loaded: 1 }))
	})

	test('logs a broken skill symlink without paging Sentry and continues loading healthy files', async () => {
		const home = await directory(join(fixtureRoot, 'home'))
		const codexHome = await directory(join(fixtureRoot, 'codex'))
		const cwd = await directory(join(fixtureRoot, 'cwd'))
		const bundled = await directory(join(fixtureRoot, 'bundled'))
		const skillsRoot = await directory(join(cwd, '.codex', 'skills'))
		await skill(skillsRoot, 'healthy', 'healthy')
		const broken = await directory(join(skillsRoot, 'broken'))
		await symlink(join(fixtureRoot, 'does-not-exist'), join(broken, 'SKILL.md'))

		const result = await discoverCodexSkills({
			cwd,
			home,
			codexHome,
			bundledRpiRoot: bundled,
			configuredRepoRoots: [],
		})

		expect(result.skills.map((entry) => entry.name)).toEqual(['healthy'])
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				stage: 'file',
				sourceKind: 'project',
				path: join(broken, 'SKILL.md'),
				code: 'entry_stat_failed',
			}),
		])
		expect(mockLogger.error).toHaveBeenCalledWith(
			expect.objectContaining({ errorCode: 'entry_stat_failed' }),
			expect.any(String),
		)
		expect(mockCaptureException).not.toHaveBeenCalled()
	})

	test('discovers enabled versioned plugins after user roots without changing Codex files', async () => {
		const home = await directory(join(fixtureRoot, 'home'))
		const codexHome = await directory(join(fixtureRoot, 'codex'))
		const cwd = await directory(join(fixtureRoot, 'cwd'))
		const bundled = await directory(join(fixtureRoot, 'bundled'))
		await directory(join(cwd, '.git'))
		await skill(bundled, 'plan', 'plan', 'bundled plan')
		await skill(join(codexHome, 'skills'), 'user-plugin-collision', 'alpha:shared', 'user winner')

		const alphaOld = await pluginBundle(codexHome, 'company', 'alpha', '9.0.0')
		await skill(join(alphaOld, 'skills'), 'old', 'unique', 'wrong numbered version')
		const alphaLocal = await pluginBundle(codexHome, 'company', 'alpha', 'local')
		await skill(join(alphaLocal, 'skills'), 'shared', 'shared', 'plugin collision loser')
		await skill(join(alphaLocal, 'skills'), 'unique', 'unique', 'local winner')
		await symlink(alphaOld, join(codexHome, 'plugins', 'cache', 'company', 'alpha', '8.0-link'))
		await writeFile(join(codexHome, 'plugins', 'cache', 'company', 'alpha', 'README.txt'), 'cache metadata')

		const semverOld = await pluginBundle(codexHome, 'company', 'semver', '1.9.0', { skills: './custom-skills' })
		await skill(join(semverOld, 'custom-skills'), 'version', 'versioned', 'old semver')
		const semverWinner = await pluginBundle(codexHome, 'company', 'semver', '1.10.0', {
			skills: ['./custom-skills'],
		})
		await skill(join(semverWinner, 'custom-skills'), 'version', 'versioned', 'semver winner')

		const lexicalTen = await pluginBundle(codexHome, 'company', 'lexical', 'release-10', {
			manifestDirectory: '.claude-plugin',
		})
		await skill(join(lexicalTen, 'skills'), 'version', 'lexical', 'lexical loser')
		const lexicalTwo = await pluginBundle(codexHome, 'company', 'lexical', 'release-2', {
			manifestDirectory: '.claude-plugin',
		})
		await skill(join(lexicalTwo, 'skills'), 'version', 'lexical', 'lexical winner')

		const rpi = await pluginBundle(codexHome, 'company', 'rpi', '1.0.0')
		await skill(join(rpi, 'skills'), 'plan', 'plan', 'installed rpi loser')
		const disabled = await pluginBundle(codexHome, 'company', 'disabled', '1.0.0')
		await skill(join(disabled, 'skills'), 'disabled', 'disabled', 'must not load')
		const absent = await pluginBundle(codexHome, 'company', 'absent', '1.0.0')
		await skill(join(absent, 'skills'), 'absent', 'absent', 'not configured')

		const configPath = join(codexHome, 'config.toml')
		const marketplaceRoot = await directory(join(fixtureRoot, 'marketplace'))
		await writeFile(join(marketplaceRoot, 'marketplace.json'), '{"plugins":[]}')
		await writeFile(
			configPath,
			[
				'[features]',
				'plugins = true',
				'[plugins."alpha@company"]',
				'[plugins."semver@company"]',
				'enabled = true',
				'[plugins."lexical@company"]',
				'enabled = true',
				'[plugins."rpi@company"]',
				'enabled = true',
				'[plugins."disabled@company"]',
				'enabled = false',
			].join('\n'),
		)
		const cacheRoot = join(codexHome, 'plugins', 'cache')
		const watchedPaths = [
			fixtureRoot,
			configPath,
			marketplaceRoot,
			cacheRoot,
			join(alphaLocal, '.claude-plugin', 'plugin.json'),
			join(alphaLocal, 'skills'),
			join(codexHome, 'plugins', 'data'),
			join(codexHome, 'plugins', 'cache', 'company', 'never-created'),
		]

		const result = await expectReadOnly(watchedPaths, () =>
			discoverCodexSkills({
				cwd,
				home,
				codexHome,
				bundledRpiRoot: bundled,
				configuredRepoRoots: [],
			}),
		)

		expect(result.skills.map((entry) => entry.name)).toEqual([
			'rpi:plan',
			'alpha:shared',
			'alpha:unique',
			'semver:versioned',
			'lexical:lexical',
		])
		expect(result.skills.find((entry) => entry.name === 'alpha:shared')?.content).toContain('user winner')
		expect(result.skills.find((entry) => entry.name === 'alpha:unique')?.content).toContain('local winner')
		expect(result.skills.find((entry) => entry.name === 'semver:versioned')?.content).toContain('semver winner')
		expect(result.skills.find((entry) => entry.name === 'lexical:lexical')?.content).toContain('lexical winner')
		expect(result.skills.map((entry) => entry.content).join('\n')).not.toContain('must not load')
		expect(result.skills.map((entry) => entry.content).join('\n')).not.toContain('not configured')
		expect(result.skills.map((entry) => entry.content).join('\n')).not.toContain('installed rpi loser')
		const expectedPluginSources = [
			{
				kind: 'plugin',
				root: `plugin://${token('plugin', 'alpha@company')}/${token('path', join('local', 'skills'))}`,
				pluginIdentityToken: token('plugin', 'alpha@company'),
				pluginConfigIndex: 0,
				pluginVersionToken: token('version', 'local'),
				pluginVersionKind: 'local',
			},
			{
				kind: 'plugin',
				root: `plugin://${token('plugin', 'semver@company')}/${token('path', join('1.10.0', 'custom-skills'))}`,
				pluginIdentityToken: token('plugin', 'semver@company'),
				pluginConfigIndex: 1,
				pluginVersionToken: token('version', '1.10.0'),
				pluginVersionKind: 'semver',
			},
			{
				kind: 'plugin',
				root: `plugin://${token('plugin', 'lexical@company')}/${token('path', join('release-2', 'skills'))}`,
				pluginIdentityToken: token('plugin', 'lexical@company'),
				pluginConfigIndex: 2,
				pluginVersionToken: token('version', 'release-2'),
				pluginVersionKind: 'opaque',
			},
			{
				kind: 'plugin',
				root: `plugin://${token('plugin', 'rpi@company')}/${token('path', join('1.0.0', 'skills'))}`,
				pluginIdentityToken: token('plugin', 'rpi@company'),
				pluginConfigIndex: 3,
				pluginVersionToken: token('version', '1.0.0'),
				pluginVersionKind: 'semver',
			},
		]
		expect(result.sources.filter((source) => source.kind === 'plugin')).toEqual(expectedPluginSources)
		const pluginSkills = result.skills.filter((entry) => entry.source.kind === 'plugin')
		expect(pluginSkills.map((entry) => entry.source)).toEqual(expectedPluginSources.slice(0, 3))
		expect(pluginSkills.map((entry) => entry.baseDir)).toEqual([
			join(alphaLocal, 'skills', 'unique'),
			join(semverWinner, 'custom-skills', 'version'),
			join(lexicalTwo, 'skills', 'version'),
		])
		const pluginSkillSources = JSON.stringify(pluginSkills.map((entry) => entry.source))
		for (const unsafePayload of [
			fixtureRoot,
			codexHome,
			cacheRoot,
			'alpha@company',
			'semver@company',
			'lexical@company',
		]) {
			expect(pluginSkillSources).not.toContain(unsafePayload)
		}
		expect(pluginSkillSources).toContain('plugin://')
		expect(pluginSkillSources).toContain('pluginIdentityToken')
		expect(pluginSkillSources).toContain('pluginVersionToken')
		expect(result.diagnostics).toEqual([])
		expect(mockCaptureException).not.toHaveBeenCalled()
		const pluginBoundaryEvents = mockLogger.info.mock.calls
			.map(([event]) => event)
			.filter((event) => ['cache', 'manifest'].includes(event.stage))
		const selectedEvents = pluginBoundaryEvents
			.filter((event) => event.outcome === 'selected' && event.stage === 'cache')
			.map(({ configIndex, pluginIdentityToken, versionKind, versionToken }) => ({
				configIndex,
				pluginIdentityToken,
				versionKind,
				versionToken,
			}))
		expect(selectedEvents).toEqual([
			{
				configIndex: 0,
				pluginIdentityToken: token('plugin', 'alpha@company'),
				versionKind: 'local',
				versionToken: token('version', 'local'),
			},
			{
				configIndex: 1,
				pluginIdentityToken: token('plugin', 'semver@company'),
				versionKind: 'semver',
				versionToken: token('version', '1.10.0'),
			},
			{
				configIndex: 2,
				pluginIdentityToken: token('plugin', 'lexical@company'),
				versionKind: 'opaque',
				versionToken: token('version', 'release-2'),
			},
			{
				configIndex: 3,
				pluginIdentityToken: token('plugin', 'rpi@company'),
				versionKind: 'semver',
				versionToken: token('version', '1.0.0'),
			},
		])
		expectBoundaryPayloadsExclude('alpha@company', result.diagnostics)
		expectBoundaryPayloadsExclude('alpha', result.diagnostics)
		expectBoundaryPayloadsExclude('company', result.diagnostics)
		expectBoundaryPayloadsExclude('release-2', result.diagnostics)
	})

	test('treats global and per-plugin disablement and missing caches as informational', async () => {
		const home = await directory(join(fixtureRoot, 'home'))
		const codexHome = await directory(join(fixtureRoot, 'codex'))
		const cwd = await directory(join(fixtureRoot, 'cwd'))
		const bundled = await directory(join(fixtureRoot, 'bundled'))
		const configPath = join(codexHome, 'config.toml')
		await writeFile(
			configPath,
			[
				'[features]',
				'plugins = false',
				'[plugins."../MALFORMED_IDENTITY_SECRET@company"]',
				'enabled = "INVALID_ENABLED_SECRET"',
				'[plugins."valid-but-off@company"]',
				'enabled = true',
			].join('\n'),
		)

		const globallyDisabled = await discoverCodexSkills({
			cwd,
			home,
			codexHome,
			bundledRpiRoot: bundled,
			configuredRepoRoots: [],
		})
		expect(globallyDisabled.skills).toEqual([])
		expect(globallyDisabled.diagnostics).toEqual([])
		expect(mockLogger.error).not.toHaveBeenCalled()
		expect(mockCaptureException).not.toHaveBeenCalled()
		expect(
			mockLogger.info.mock.calls
				.map(([event]) => event)
				.filter((event) => event.stage === 'config' && event.outcome === 'disabled')
				.map(({ scope, reason, configIndex, pluginIdentityToken, pluginClassification }) => ({
					scope,
					reason,
					configIndex,
					pluginIdentityToken,
					pluginClassification,
				})),
		).toEqual([
			{
				scope: 'global',
				reason: 'feature-disabled',
				configIndex: undefined,
				pluginIdentityToken: undefined,
				pluginClassification: undefined,
			},
			{
				scope: 'entry',
				reason: 'feature-disabled',
				configIndex: 0,
				pluginIdentityToken: undefined,
				pluginClassification: undefined,
			},
			{
				scope: 'entry',
				reason: 'feature-disabled',
				configIndex: 1,
				pluginIdentityToken: undefined,
				pluginClassification: undefined,
			},
		])
		expect(mockLogger.info.mock.calls.some(([event]) => event.stage === 'cache')).toBe(false)
		expect(capturedPayloads()).not.toContain('MALFORMED_IDENTITY_SECRET')
		expect(capturedPayloads()).not.toContain('INVALID_ENABLED_SECRET')

		mockLogger.info.mockClear()
		await writeFile(
			configPath,
			['[plugins."missing@company"]', 'enabled = true', '[plugins."off@company"]', 'enabled = false'].join('\n'),
		)
		await directory(join(codexHome, 'plugins', 'cache'))
		const missing = await discoverCodexSkills({
			cwd,
			home,
			codexHome,
			bundledRpiRoot: bundled,
			configuredRepoRoots: [],
		})
		expect(missing.diagnostics).toEqual([])
		expect(mockCaptureException).not.toHaveBeenCalled()
		const correlatedOutcomes = mockLogger.info.mock.calls
			.map(([event]) => event)
			.filter(
				(event) =>
					(event.stage === 'config' && event.outcome === 'disabled') ||
					(event.stage === 'cache' && event.outcome === 'missing'),
			)
			.map(({ stage, outcome, configIndex, pluginIdentityToken, pluginClassification }) => ({
				stage,
				outcome,
				configIndex,
				pluginIdentityToken,
				pluginClassification,
			}))
		expect(correlatedOutcomes).toEqual([
			{
				stage: 'config',
				outcome: 'disabled',
				configIndex: 1,
				pluginIdentityToken: token('plugin', 'off@company'),
				pluginClassification: 'valid-identity',
			},
			{
				stage: 'cache',
				outcome: 'missing',
				configIndex: 0,
				pluginIdentityToken: token('plugin', 'missing@company'),
				pluginClassification: 'valid-identity',
			},
		])
	})

	test('emits one exact normalized ordered Phase 4 boundary sequence and continues after rejection', async () => {
		const home = await directory(join(fixtureRoot, 'home'))
		const codexHome = await directory(join(fixtureRoot, 'codex'))
		const cwd = await directory(join(fixtureRoot, 'cwd'))
		const bundled = await directory(join(fixtureRoot, 'bundled'))
		await directory(join(cwd, '.git'))
		await skill(join(codexHome, 'skills'), 'collision', 'primary:shared', 'user collision winner')

		await pluginBundle(codexHome, 'market', 'primary', '1.0.0')
		const primary = await pluginBundle(codexHome, 'market', 'primary', '2.0.0', {
			skills: ['./skills', './alias-skills'],
		})
		await skill(join(primary, 'skills'), 'a-collision', 'shared', 'plugin collision loser')
		await skill(join(primary, 'skills'), 'b-loaded', 'loaded', 'plugin loaded')
		await symlink(join(primary, 'skills'), join(primary, 'alias-skills'))

		const fallback = await pluginBundle(codexHome, 'market', 'fallback', 'local', {
			manifestDirectory: '.claude-plugin',
		})
		await skill(join(fallback, 'skills'), 'loaded', 'loaded', 'fallback loaded')
		await pluginBundle(codexHome, 'market', 'rejected', '1.0.0', { skills: '../outside' })
		const continued = await pluginBundle(codexHome, 'market', 'continued', '1.0.0')
		await skill(join(continued, 'skills'), 'loaded', 'loaded', 'continued after rejection')

		await writeFile(
			join(codexHome, 'config.toml'),
			[
				'[plugins."primary@market"]',
				'[plugins."fallback@market"]',
				'[plugins."missing@market"]',
				'[plugins."rejected@market"]',
				'[plugins."continued@market"]',
				'[plugins."disabled@market"]',
				'enabled = false',
			].join('\n'),
		)

		const result = await discoverCodexSkills({
			cwd,
			home,
			codexHome,
			bundledRpiRoot: bundled,
			configuredRepoRoots: [],
		})

		expect(result.skills.map((entry) => entry.name)).toEqual([
			'primary:shared',
			'primary:loaded',
			'fallback:loaded',
			'continued:loaded',
		])
		expect(result.diagnostics.map((entry) => entry.code)).toEqual(['plugin_manifest_validation_failed'])

		const sequence = mockLogger.info.mock.calls
			.map(([event]) => event)
			.filter(
				(event) =>
					event.stage === 'config' ||
					event.stage === 'cache' ||
					event.stage === 'manifest' ||
					(event.sourceKind === 'plugin' && (event.stage === 'root' || event.stage === 'file')),
			)
			.map(
				({
					stage,
					outcome,
					sourceKind,
					path,
					configIndex,
					pluginIdentityToken,
					versionKind,
					versionToken,
					scope,
					reason,
					rootIndex,
					selection,
				}) => {
					const normalizedPath =
						path === join(codexHome, 'config.toml')
							? '<codex>/config.toml'
							: path === join(codexHome, 'plugins', 'cache')
								? '<codex>/plugins/cache'
								: path
					return [
						stage,
						outcome,
						sourceKind,
						normalizedPath,
						configIndex,
						pluginIdentityToken,
						versionKind,
						versionToken,
						scope,
						reason,
						rootIndex,
						selection,
					]
						.map((value) => value ?? '-')
						.join('|')
				},
			)
		expect(sequence).toMatchInlineSnapshot(`
			[
			  "config|checked|config|<codex>/config.toml|-|-|-|-|-|-|-|-",
			  "config|found|config|<codex>/config.toml|-|-|-|-|-|-|-|-",
			  "config|loaded|config|<codex>/config.toml|-|-|-|-|global|-|-|-",
			  "config|checked|config|<codex>/config.toml|0|-|-|-|-|-|-|-",
			  "config|loaded|config|<codex>/config.toml|0|plugin-98917295c9c27844|-|-|entry|-|-|-",
			  "config|checked|config|<codex>/config.toml|1|-|-|-|-|-|-|-",
			  "config|loaded|config|<codex>/config.toml|1|plugin-ad9640c5d2d85d46|-|-|entry|-|-|-",
			  "config|checked|config|<codex>/config.toml|2|-|-|-|-|-|-|-",
			  "config|loaded|config|<codex>/config.toml|2|plugin-8a43f20e010486d9|-|-|entry|-|-|-",
			  "config|checked|config|<codex>/config.toml|3|-|-|-|-|-|-|-",
			  "config|loaded|config|<codex>/config.toml|3|plugin-4dedcfe7b947ee2d|-|-|entry|-|-|-",
			  "config|checked|config|<codex>/config.toml|4|-|-|-|-|-|-|-",
			  "config|loaded|config|<codex>/config.toml|4|plugin-8feb2c0e51d13e86|-|-|entry|-|-|-",
			  "config|checked|config|<codex>/config.toml|5|-|-|-|-|-|-|-",
			  "config|disabled|config|<codex>/config.toml|5|plugin-007a3dbb174cfb43|-|-|entry|plugin-disabled|-|-",
			  "cache|checked|plugin|<codex>/plugins/cache|-|-|-|-|-|-|-|-",
			  "cache|found|plugin|<codex>/plugins/cache|-|-|-|-|-|-|-|-",
			  "cache|checked|plugin|plugin://plugin-98917295c9c27844/path-e3b0c44298fc1c14|0|plugin-98917295c9c27844|-|-|-|-|-|-",
			  "cache|found|plugin|plugin://plugin-98917295c9c27844/path-e3b0c44298fc1c14|0|plugin-98917295c9c27844|-|-|-|-|-|-",
			  "cache|checked|plugin|plugin://plugin-98917295c9c27844/path-92521fc3cbd964bd|0|plugin-98917295c9c27844|semver|version-92521fc3cbd964bd|-|-|-|-",
			  "cache|found|plugin|plugin://plugin-98917295c9c27844/path-92521fc3cbd964bd|0|plugin-98917295c9c27844|semver|version-92521fc3cbd964bd|-|-|-|-",
			  "cache|checked|plugin|plugin://plugin-98917295c9c27844/path-f22abd6773ab2328|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|-|-",
			  "cache|found|plugin|plugin://plugin-98917295c9c27844/path-f22abd6773ab2328|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|-|-",
			  "cache|selected|plugin|plugin://plugin-98917295c9c27844/path-f22abd6773ab2328|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|-|version",
			  "manifest|checked|plugin|plugin://plugin-98917295c9c27844/path-b67c86d8d8d00518|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|-|-",
			  "manifest|found|plugin|plugin://plugin-98917295c9c27844/path-b67c86d8d8d00518|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|-|-",
			  "manifest|selected|plugin|plugin://plugin-98917295c9c27844/path-b67c86d8d8d00518|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|0|-",
			  "manifest|selected|plugin|plugin://plugin-98917295c9c27844/path-b67c86d8d8d00518|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|1|-",
			  "cache|checked|plugin|plugin://plugin-ad9640c5d2d85d46/path-e3b0c44298fc1c14|1|plugin-ad9640c5d2d85d46|-|-|-|-|-|-",
			  "cache|found|plugin|plugin://plugin-ad9640c5d2d85d46/path-e3b0c44298fc1c14|1|plugin-ad9640c5d2d85d46|-|-|-|-|-|-",
			  "cache|checked|plugin|plugin://plugin-ad9640c5d2d85d46/path-25bf8e1a2393f110|1|plugin-ad9640c5d2d85d46|local|version-25bf8e1a2393f110|-|-|-|-",
			  "cache|found|plugin|plugin://plugin-ad9640c5d2d85d46/path-25bf8e1a2393f110|1|plugin-ad9640c5d2d85d46|local|version-25bf8e1a2393f110|-|-|-|-",
			  "cache|selected|plugin|plugin://plugin-ad9640c5d2d85d46/path-25bf8e1a2393f110|1|plugin-ad9640c5d2d85d46|local|version-25bf8e1a2393f110|-|-|-|local",
			  "manifest|checked|plugin|plugin://plugin-ad9640c5d2d85d46/path-4def66e0eeaa43fd|1|plugin-ad9640c5d2d85d46|local|version-25bf8e1a2393f110|-|-|-|-",
			  "manifest|missing|plugin|plugin://plugin-ad9640c5d2d85d46/path-4def66e0eeaa43fd|1|plugin-ad9640c5d2d85d46|local|version-25bf8e1a2393f110|-|-|-|-",
			  "manifest|checked|plugin|plugin://plugin-ad9640c5d2d85d46/path-847857319b6c0aa1|1|plugin-ad9640c5d2d85d46|local|version-25bf8e1a2393f110|-|-|-|-",
			  "manifest|found|plugin|plugin://plugin-ad9640c5d2d85d46/path-847857319b6c0aa1|1|plugin-ad9640c5d2d85d46|local|version-25bf8e1a2393f110|-|-|-|-",
			  "manifest|selected|plugin|plugin://plugin-ad9640c5d2d85d46/path-847857319b6c0aa1|1|plugin-ad9640c5d2d85d46|local|version-25bf8e1a2393f110|-|-|0|-",
			  "cache|checked|plugin|plugin://plugin-8a43f20e010486d9/path-e3b0c44298fc1c14|2|plugin-8a43f20e010486d9|-|-|-|-|-|-",
			  "cache|missing|plugin|plugin://plugin-8a43f20e010486d9/path-e3b0c44298fc1c14|2|plugin-8a43f20e010486d9|-|-|-|-|-|-",
			  "cache|checked|plugin|plugin://plugin-4dedcfe7b947ee2d/path-e3b0c44298fc1c14|3|plugin-4dedcfe7b947ee2d|-|-|-|-|-|-",
			  "cache|found|plugin|plugin://plugin-4dedcfe7b947ee2d/path-e3b0c44298fc1c14|3|plugin-4dedcfe7b947ee2d|-|-|-|-|-|-",
			  "cache|checked|plugin|plugin://plugin-4dedcfe7b947ee2d/path-92521fc3cbd964bd|3|plugin-4dedcfe7b947ee2d|semver|version-92521fc3cbd964bd|-|-|-|-",
			  "cache|found|plugin|plugin://plugin-4dedcfe7b947ee2d/path-92521fc3cbd964bd|3|plugin-4dedcfe7b947ee2d|semver|version-92521fc3cbd964bd|-|-|-|-",
			  "cache|selected|plugin|plugin://plugin-4dedcfe7b947ee2d/path-92521fc3cbd964bd|3|plugin-4dedcfe7b947ee2d|semver|version-92521fc3cbd964bd|-|-|-|version",
			  "manifest|checked|plugin|plugin://plugin-4dedcfe7b947ee2d/path-b2054d9fbf2dda74|3|plugin-4dedcfe7b947ee2d|semver|version-92521fc3cbd964bd|-|-|-|-",
			  "manifest|found|plugin|plugin://plugin-4dedcfe7b947ee2d/path-b2054d9fbf2dda74|3|plugin-4dedcfe7b947ee2d|semver|version-92521fc3cbd964bd|-|-|-|-",
			  "manifest|rejected|plugin|plugin://plugin-4dedcfe7b947ee2d/path-b2054d9fbf2dda74|3|plugin-4dedcfe7b947ee2d|semver|version-92521fc3cbd964bd|-|invalid-skill-root|0|-",
			  "cache|checked|plugin|plugin://plugin-8feb2c0e51d13e86/path-e3b0c44298fc1c14|4|plugin-8feb2c0e51d13e86|-|-|-|-|-|-",
			  "cache|found|plugin|plugin://plugin-8feb2c0e51d13e86/path-e3b0c44298fc1c14|4|plugin-8feb2c0e51d13e86|-|-|-|-|-|-",
			  "cache|checked|plugin|plugin://plugin-8feb2c0e51d13e86/path-92521fc3cbd964bd|4|plugin-8feb2c0e51d13e86|semver|version-92521fc3cbd964bd|-|-|-|-",
			  "cache|found|plugin|plugin://plugin-8feb2c0e51d13e86/path-92521fc3cbd964bd|4|plugin-8feb2c0e51d13e86|semver|version-92521fc3cbd964bd|-|-|-|-",
			  "cache|selected|plugin|plugin://plugin-8feb2c0e51d13e86/path-92521fc3cbd964bd|4|plugin-8feb2c0e51d13e86|semver|version-92521fc3cbd964bd|-|-|-|version",
			  "manifest|checked|plugin|plugin://plugin-8feb2c0e51d13e86/path-b2054d9fbf2dda74|4|plugin-8feb2c0e51d13e86|semver|version-92521fc3cbd964bd|-|-|-|-",
			  "manifest|found|plugin|plugin://plugin-8feb2c0e51d13e86/path-b2054d9fbf2dda74|4|plugin-8feb2c0e51d13e86|semver|version-92521fc3cbd964bd|-|-|-|-",
			  "manifest|selected|plugin|plugin://plugin-8feb2c0e51d13e86/path-b2054d9fbf2dda74|4|plugin-8feb2c0e51d13e86|semver|version-92521fc3cbd964bd|-|-|0|-",
			  "root|checked|plugin|plugin://plugin-98917295c9c27844/path-9e1cf2a4562b4aff|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|-|-",
			  "root|found|plugin|plugin://plugin-98917295c9c27844/path-9e1cf2a4562b4aff|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|-|-",
			  "file|checked|plugin|plugin://plugin-98917295c9c27844/path-6a2961a78b9352ac|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|-|-",
			  "file|found|plugin|plugin://plugin-98917295c9c27844/path-6a2961a78b9352ac|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|-|-",
			  "file|collision|plugin|plugin://plugin-98917295c9c27844/path-6a2961a78b9352ac|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|-|-",
			  "file|checked|plugin|plugin://plugin-98917295c9c27844/path-0f638f54b004fedc|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|-|-",
			  "file|found|plugin|plugin://plugin-98917295c9c27844/path-0f638f54b004fedc|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|-|-",
			  "file|loaded|plugin|plugin://plugin-98917295c9c27844/path-0f638f54b004fedc|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|-|-",
			  "root|checked|plugin|plugin://plugin-98917295c9c27844/path-91cf50e4dc6004e4|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|-|-",
			  "root|found|plugin|plugin://plugin-98917295c9c27844/path-91cf50e4dc6004e4|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|-|-",
			  "root|deduplicated|plugin|plugin://plugin-98917295c9c27844/path-91cf50e4dc6004e4|0|plugin-98917295c9c27844|semver|version-f22abd6773ab2328|-|-|-|-",
			  "root|checked|plugin|plugin://plugin-ad9640c5d2d85d46/path-0e75729fd1eb94c8|1|plugin-ad9640c5d2d85d46|local|version-25bf8e1a2393f110|-|-|-|-",
			  "root|found|plugin|plugin://plugin-ad9640c5d2d85d46/path-0e75729fd1eb94c8|1|plugin-ad9640c5d2d85d46|local|version-25bf8e1a2393f110|-|-|-|-",
			  "file|checked|plugin|plugin://plugin-ad9640c5d2d85d46/path-920883e39bb369ac|1|plugin-ad9640c5d2d85d46|local|version-25bf8e1a2393f110|-|-|-|-",
			  "file|found|plugin|plugin://plugin-ad9640c5d2d85d46/path-920883e39bb369ac|1|plugin-ad9640c5d2d85d46|local|version-25bf8e1a2393f110|-|-|-|-",
			  "file|loaded|plugin|plugin://plugin-ad9640c5d2d85d46/path-920883e39bb369ac|1|plugin-ad9640c5d2d85d46|local|version-25bf8e1a2393f110|-|-|-|-",
			  "root|checked|plugin|plugin://plugin-8feb2c0e51d13e86/path-3cedc709cb6b3f5d|4|plugin-8feb2c0e51d13e86|semver|version-92521fc3cbd964bd|-|-|-|-",
			  "root|found|plugin|plugin://plugin-8feb2c0e51d13e86/path-3cedc709cb6b3f5d|4|plugin-8feb2c0e51d13e86|semver|version-92521fc3cbd964bd|-|-|-|-",
			  "file|checked|plugin|plugin://plugin-8feb2c0e51d13e86/path-58d7b457673c0b03|4|plugin-8feb2c0e51d13e86|semver|version-92521fc3cbd964bd|-|-|-|-",
			  "file|found|plugin|plugin://plugin-8feb2c0e51d13e86/path-58d7b457673c0b03|4|plugin-8feb2c0e51d13e86|semver|version-92521fc3cbd964bd|-|-|-|-",
			  "file|loaded|plugin|plugin://plugin-8feb2c0e51d13e86/path-58d7b457673c0b03|4|plugin-8feb2c0e51d13e86|semver|version-92521fc3cbd964bd|-|-|-|-",
			]
		`)
	})

	test('rejects malformed identities, manifests, roots, and escaped symlinks while healthy plugins continue', async () => {
		const configSecret = 'CONFIG_SECRET_7d41'
		const manifestSecret = 'MANIFEST_SECRET_31ba'
		const skillSecret = 'SKILL_SECRET_f91e'
		const home = await directory(join(fixtureRoot, 'home'))
		const codexHome = await directory(join(fixtureRoot, 'codex'))
		const cwd = await directory(join(fixtureRoot, 'cwd'))
		const bundled = await directory(join(fixtureRoot, 'bundled'))

		const healthy = await pluginBundle(codexHome, 'company', 'healthy', '1.0.0')
		await skill(join(healthy, 'skills'), 'healthy', 'healthy', skillSecret)
		const brokenSkillPath = join(await directory(join(healthy, 'skills', 'broken')), 'SKILL.md')
		await writeFile(brokenSkillPath, `---\nname: [${skillSecret}\ndescription: hidden\n---\n`)
		const malformed = await directory(join(codexHome, 'plugins', 'cache', 'company', 'malformed', '1.0.0'))
		await writeFile(
			join(await directory(join(malformed, '.codex-plugin')), 'plugin.json'),
			`{"name":"malformed","private":"${manifestSecret}"`,
		)
		const mismatch = await pluginBundle(codexHome, 'company', 'mismatch', '1.0.0')
		await writeFile(join(mismatch, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: manifestSecret }))
		const traversal = await pluginBundle(codexHome, 'company', 'traversal', '1.0.0', { skills: './../outside' })
		expect(traversal).toContain('traversal')
		const escaped = await pluginBundle(codexHome, 'company', 'escaped', '1.0.0', { skills: './linked-skills' })
		const outside = await directory(join(fixtureRoot, 'outside-skills'))
		await skill(outside, 'private', 'private', skillSecret)
		await symlink(outside, join(escaped, 'linked-skills'))

		const configPath = join(codexHome, 'config.toml')
		await writeFile(
			configPath,
			[
				`unused_value = "${configSecret}"`,
				'[plugins."healthy@company"]',
				'[plugins."malformed@company"]',
				'[plugins."mismatch@company"]',
				'[plugins."traversal@company"]',
				'[plugins."escaped@company"]',
				'[plugins."../invalid@company"]',
				'[plugins."invalid-enabled@company"]',
				`enabled = "${configSecret}"`,
			].join('\n'),
		)
		const marketplaceRoot = await directory(join(fixtureRoot, 'failure-marketplace'))
		await writeFile(join(marketplaceRoot, 'marketplace.json'), '{"plugins":[]}')
		const watchedPaths = [
			fixtureRoot,
			configPath,
			marketplaceRoot,
			join(codexHome, 'plugins', 'cache'),
			join(malformed, '.codex-plugin', 'plugin.json'),
			join(healthy, 'skills'),
			join(escaped, 'linked-skills'),
			outside,
			join(codexHome, 'plugins', 'data'),
			join(escaped, '.claude-plugin', 'plugin.json'),
		]

		const result = await expectReadOnly(watchedPaths, () =>
			discoverCodexSkills({
				cwd,
				home,
				codexHome,
				bundledRpiRoot: bundled,
				configuredRepoRoots: [],
			}),
		)

		expect(result.skills.map((entry) => entry.name)).toEqual(['healthy:healthy'])
		expect(result.diagnostics.map((entry) => entry.code).toSorted()).toEqual([
			'frontmatter_parse_failed',
			'plugin_config_validation_failed',
			'plugin_identity_invalid',
			'plugin_manifest_parse_failed',
			'plugin_manifest_validation_failed',
			'plugin_manifest_validation_failed',
			'plugin_skill_root_path_escape',
		])
		expect(mockLogger.error).toHaveBeenCalledTimes(7)
		expect(mockCaptureException).toHaveBeenCalledTimes(0)
		expectBoundaryPayloadsExclude(configSecret, result.diagnostics)
		expectBoundaryPayloadsExclude(manifestSecret, result.diagnostics)
		expectBoundaryPayloadsExclude(skillSecret, result.diagnostics)
		expect(result.skills.map((entry) => entry.name)).not.toContain('escaped:private')

		const manifestIdentityToken = token('plugin', 'malformed@company')
		const manifestVersionToken = token('version', '1.0.0')
		const manifestPathToken = token('path', join('1.0.0', '.codex-plugin', 'plugin.json'))
		const manifestDiagnostic = result.diagnostics.find((entry) => entry.code === 'plugin_manifest_parse_failed')
		expect(manifestDiagnostic).toEqual({
			stage: 'manifest',
			sourceKind: 'plugin',
			path: `plugin://${manifestIdentityToken}/${manifestPathToken}`,
			pathToken: manifestPathToken,
			configIndex: 1,
			pluginIdentityToken: manifestIdentityToken,
			pluginClassification: 'valid-identity',
			versionKind: 'semver',
			versionToken: manifestVersionToken,
			code: 'plugin_manifest_parse_failed',
			message: 'Codex plugin manifest could not be parsed',
		})
		expect(
			mockLogger.error.mock.calls.find(([event]) => event.errorCode === 'plugin_manifest_parse_failed'),
		).toEqual([
			{
				discovery: 'codex-skills',
				outcome: 'error',
				errorCode: 'plugin_manifest_parse_failed',
				stage: 'manifest',
				sourceKind: 'plugin',
				path: `plugin://${manifestIdentityToken}/${manifestPathToken}`,
				pathToken: manifestPathToken,
				configIndex: 1,
				pluginIdentityToken: manifestIdentityToken,
				pluginClassification: 'valid-identity',
				versionKind: 'semver',
				versionToken: manifestVersionToken,
			},
			'Codex skill discovery failed',
		])

		const skillIdentityToken = token('plugin', 'healthy@company')
		const skillPathToken = token('path', join('1.0.0', 'skills', 'broken', 'SKILL.md'))
		const skillDiagnostic = result.diagnostics.find((entry) => entry.code === 'frontmatter_parse_failed')
		expect(skillDiagnostic).toEqual({
			stage: 'file',
			sourceKind: 'plugin',
			path: `plugin://${skillIdentityToken}/${skillPathToken}`,
			pathToken: skillPathToken,
			configIndex: 0,
			pluginIdentityToken: skillIdentityToken,
			pluginClassification: 'valid-identity',
			versionKind: 'semver',
			versionToken: manifestVersionToken,
			code: 'frontmatter_parse_failed',
			message: 'Skill frontmatter could not be parsed',
		})
	})

	test('classifies cache and manifest I/O failures safely and continues with a healthy plugin', async () => {
		const home = await directory(join(fixtureRoot, 'home'))
		const codexHome = await directory(join(fixtureRoot, 'codex'))
		const cwd = await directory(join(fixtureRoot, 'cwd'))
		const bundled = await directory(join(fixtureRoot, 'bundled'))
		const healthy = await pluginBundle(codexHome, 'company', 'healthy', '1.0.0')
		await skill(join(healthy, 'skills'), 'healthy', 'healthy')
		await writeFile(join(codexHome, 'plugins', 'cache', 'company', 'cache-file'), 'not a cache directory')
		const unreadableManifest = await directory(
			join(codexHome, 'plugins', 'cache', 'company', 'manifest-read', '1.0.0', '.codex-plugin', 'plugin.json'),
		)
		expect(unreadableManifest).toContain('plugin.json')
		const configPath = join(codexHome, 'config.toml')
		await writeFile(
			configPath,
			['[plugins."healthy@company"]', '[plugins."cache-file@company"]', '[plugins."manifest-read@company"]'].join(
				'\n',
			),
		)
		const marketplaceRoot = await directory(join(fixtureRoot, 'io-failure-marketplace'))
		await writeFile(join(marketplaceRoot, 'marketplace.json'), '{"plugins":[]}')
		const watchedPaths = [
			fixtureRoot,
			configPath,
			marketplaceRoot,
			join(codexHome, 'plugins', 'cache'),
			join(healthy, '.codex-plugin', 'plugin.json'),
			join(healthy, 'skills'),
			unreadableManifest,
			join(codexHome, 'plugins', 'data'),
			join(codexHome, 'plugins', 'cache', 'company', 'manifest-read', '1.0.0', '.claude-plugin'),
		]

		const result = await expectReadOnly(watchedPaths, () =>
			discoverCodexSkills({
				cwd,
				home,
				codexHome,
				bundledRpiRoot: bundled,
				configuredRepoRoots: [],
			}),
		)

		expect(result.skills.map((entry) => entry.name)).toEqual(['healthy:healthy'])
		expect(result.diagnostics.map((entry) => entry.code).toSorted()).toEqual([
			'plugin_cache_read_failed',
			'plugin_manifest_read_failed',
		])
		expect(mockLogger.error).toHaveBeenCalledTimes(2)
		expect(mockCaptureException).toHaveBeenCalledTimes(0)
	})
})

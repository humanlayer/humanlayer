#!/usr/bin/env bun

import { randomUUID } from 'node:crypto'
import { lstat, open, readFile, realpath, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { createDatabaseConnection, runStaleDaemonSweep } from '../apps/stale-daemon-sweeper/index'
// Use the owning workspace's installed dependencies, without adding root dependencies.
import { migrate } from '../apps/stale-daemon-sweeper/node_modules/drizzle-orm/postgres-js/migrator'
import postgres from '../apps/stale-daemon-sweeper/node_modules/postgres'
import z from '../apps/stale-daemon-sweeper/node_modules/zod/v4'
import { agentSlashCommands } from '../packages/db/src/tables/agent-slash-commands'
import { conversationEvents } from '../packages/db/src/tables/conversation-events'
import { hostAliases } from '../packages/db/src/tables/host-aliases'
import { onlineHosts } from '../packages/db/src/tables/online-hosts'
import { organizations } from '../packages/db/src/tables/organizations'
import { providerLoginRequests } from '../packages/db/src/tables/provider-login-requests'
import { sessions } from '../packages/db/src/tables/sessions'
import { migrationsFolder } from '../packages/test-fixtures/src/postgres'

const HELP = `Local host cleanup verifier (never sweeps the app database)

bun --bun scripts/verify-host-cleanup.ts seed --stack ID --scope sweep
bun --bun scripts/verify-host-cleanup.ts seed --stack ID --scope ui --user-id USER --organization-id UUID
bun --bun scripts/verify-host-cleanup.ts prepare-handoff --stack ID --user-id USER --organization-id UUID
bun --bun scripts/verify-host-cleanup.ts sweep --stack ID --manifest /tmp/host-cleanup-RUN.json
bun --bun scripts/verify-host-cleanup.ts assert-sweep --stack ID --manifest /tmp/host-cleanup-RUN.json
bun --bun scripts/verify-host-cleanup.ts assert-delete --stack ID --manifest /tmp/host-cleanup-RUN.json --target eligible
bun --bun scripts/verify-host-cleanup.ts cleanup --stack ID --manifest /tmp/host-cleanup-RUN.json

Seed prints the manifest path, fixture identities, and cleanup command. Always reuse that
explicit manifest. UI target names: eligible, fallback, race, cli. Repeat assert-delete
after each successful deletion; it remembers prior deletions and checks all controls.
Use --target none to assert cancellation/rejection preserved every remaining fixture.
After a real heartbeat revives race, use --target none --refreshed-target race.
This checks its online/recent registration and exact cache/history preservation.
Prepare-handoff creates a NEW UI run with only eligible and recent-offline fixtures.
Sweep uses the manifest's fixed time; run twice, asserting after each, to prove no-op.
Cleanup retains the manifest/evidence but marks it cleaned. No URL/env override is used.
`

const statusSchema = z.object({
	id: z.string(),
	worktreePath: z.string(),
	composeProject: z.string(),
	generatedEnvFresh: z.boolean(),
	localOrganization: z.object({ id: z.uuid(), workosOrganizationId: z.string() }),
	postgres: z.object({ databaseUrl: z.string(), postgresPort: z.number().int().positive() }),
})
const fixtureSchema = z.object({
	name: z.string(),
	hostId: z.string(),
	organizationId: z.uuid(),
	userId: z.string(),
	sweepDelete: z.boolean(),
	sessionId: z.uuid(),
	loginId: z.uuid(),
	eventId: z.uuid(),
})
const snapshotSchema = z.object({
	online_hosts: z.array(z.string()),
	host_aliases: z.array(z.string()),
	agent_slash_commands: z.array(z.string()),
	sessions: z.array(z.string()),
	provider_login_requests: z.array(z.string()),
	conversation_events: z.array(z.string()),
})
const manifestSchema = z.object({
	version: z.literal(1),
	run: z.uuid(),
	stack: z.string(),
	checkout: z.string(),
	composeProject: z.string(),
	port: z.number().int(),
	serverId: z.string(),
	scope: z.enum(['sweep', 'ui']),
	database: z.string(),
	now: z.number().int().positive(),
	createdDatabase: z.boolean(),
	cleaned: z.boolean(),
	seeded: z.boolean(),
	ownedOrganizations: z.array(z.uuid()),
	fixtures: z.array(fixtureSchema),
	baseline: z.record(z.string(), snapshotSchema),
	deleted: z.array(z.string()),
	refreshed: z.array(z.literal('race')),
	sweeps: z.array(z.object({ ephemeral: z.number().int(), offline: z.number().int() })),
})
type Manifest = z.infer<typeof manifestSchema>
type Fixture = z.infer<typeof fixtureSchema>
type Snapshot = z.infer<typeof snapshotSchema>
type Sql = postgres.Sql
const checkout = await realpath(join(import.meta.dir, '..'))
const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
	strict: true,
	options: {
		stack: { type: 'string' },
		scope: { type: 'string' },
		manifest: { type: 'string' },
		'user-id': { type: 'string' },
		'organization-id': { type: 'string' },
		target: { type: 'string' },
		'refreshed-target': { type: 'string' },
		help: { type: 'boolean' },
	},
})

function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}
function json(value: unknown): string {
	return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
}
async function command(args: string[]): Promise<string> {
	const process = Bun.spawn(args, { cwd: checkout, stdout: 'pipe', stderr: 'pipe' })
	const [stdout, stderr, code] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	])
	// Do not print command output on failure: status/inspect can contain credentials.
	check(code === 0, `${args[0]} ${args[1]} failed (exit ${code}); inspect devstack/Docker separately`)
	void stderr
	return stdout.trim()
}
function databaseUrl(base: URL, name: string): string {
	const url = new URL(base)
	url.pathname = `/${name}`
	return url.href
}
async function scoped<T>(url: string, body: (client: Sql) => Promise<T>): Promise<T> {
	const client = postgres(url, {
		max: 1,
		connect_timeout: 5,
		connection: { statement_timeout: 10_000, lock_timeout: 1_000 },
	})
	try {
		return await body(client)
	} finally {
		await client.end({ timeout: 5 })
	}
}
async function stackIdentity() {
	check(values.stack, '--stack <id> is required')
	// No --stack override here: compare against this checkout's selected stack, not another stack.
	const status = statusSchema.parse(
		JSON.parse(await command(['bun', '--bun', 'run', 'devstack', 'status', '--json'])),
	)
	check(status.id === values.stack, "Requested stack is not this checkout's selected stack")
	check((await realpath(status.worktreePath)) === checkout, 'Stack belongs to a different checkout')
	check(status.generatedEnvFresh, 'Generated stack environment is stale; sync this stack first')
	const url = new URL(status.postgres.databaseUrl)
	check(
		['postgres:', 'postgresql:'].includes(url.protocol) &&
			url.hostname === '127.0.0.1' &&
			Number(url.port) === status.postgres.postgresPort &&
			url.pathname === '/electric' &&
			url.username === 'postgres' &&
			!url.search &&
			!url.hash,
		'Refusing remote or ambiguous database target',
	)
	const compose = ['docker', 'compose', '-f', join(checkout, 'docker-compose.yaml'), '-p', status.composeProject]
	const container = await command([...compose, 'ps', '-q', 'postgres'])
	check(/^[a-f0-9]{12,64}$/.test(container), 'Expected exactly one running stack Postgres container')
	const inspectSchema = z.array(
		z.object({
			Config: z.object({ Labels: z.record(z.string(), z.string()) }),
			NetworkSettings: z.object({
				Ports: z.record(z.string(), z.array(z.object({ HostPort: z.string() })).nullable()),
			}),
		}),
	)
	const [info] = inspectSchema.parse(JSON.parse(await command(['docker', 'inspect', container])))
	check(
		info?.Config.Labels['com.docker.compose.project'] === status.composeProject &&
			info.Config.Labels['com.docker.compose.service'] === 'postgres' &&
			info.NetworkSettings.Ports['5432/tcp']?.some((p) => Number(p.HostPort) === status.postgres.postgresPort),
		'Postgres container labels/port do not match stack',
	)
	const serverId = await command([
		...compose,
		'exec',
		'-T',
		'postgres',
		'psql',
		'-U',
		'postgres',
		'-d',
		'postgres',
		'-XAt',
		'-v',
		'ON_ERROR_STOP=1',
		'-c',
		'SELECT system_identifier FROM pg_control_system()',
	])
	await scoped(databaseUrl(url, 'postgres'), async (client) => {
		const [row] = await client`SELECT system_identifier::text AS id FROM pg_control_system()`
		check(row?.id === serverId, 'TCP database is not the stack Compose Postgres server')
	})
	return { status, url, serverId }
}
function manifestPath(run: string): string {
	return `/tmp/host-cleanup-${run}.json`
}
async function save(path: string, manifest: Manifest, initial = false) {
	const tmp = initial ? path : `${path}.new`
	const file = await open(tmp, 'wx', 0o600)
	try {
		await file.writeFile(json(manifest) + '\n')
	} finally {
		await file.close()
	}
	if (!initial) await rename(tmp, path)
}
async function loadManifest(identity: Awaited<ReturnType<typeof stackIdentity>>) {
	check(values.manifest, '--manifest /tmp/host-cleanup-RUN.json is required')
	const path = resolve(values.manifest)
	const stat = await lstat(path)
	check(
		stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0,
		'Manifest must be a private regular file owned by the current user',
	)
	check((await realpath(dirname(path))) === (await realpath('/tmp')), 'Manifest must be directly under /tmp')
	const manifest = manifestSchema.parse(JSON.parse(await readFile(path, 'utf8')))
	check(path === manifestPath(manifest.run), 'Manifest filename/run mismatch')
	check(
		manifest.stack === identity.status.id &&
			manifest.checkout === checkout &&
			manifest.composeProject === identity.status.composeProject &&
			manifest.port === identity.status.postgres.postgresPort &&
			manifest.serverId === identity.serverId,
		'Manifest belongs to another stack/server/checkout',
	)
	check(
		manifest.fixtures.every((f) => f.hostId.startsWith(`verify-${manifest.run}-`)),
		'Non-run-owned host in manifest',
	)
	check(
		manifest.scope === 'sweep'
			? manifest.database === `host_cleanup_${manifest.run.replaceAll('-', '')}`
			: manifest.database === 'electric' &&
					!manifest.createdDatabase &&
					manifest.fixtures.every((f) => f.organizationId === identity.status.localOrganization.id),
		'Invalid scope/database identity',
	)
	return { path, manifest }
}
function marker(manifest: Manifest): string {
	return `host-cleanup:${manifest.stack}:${manifest.run}`
}
async function verifyDatabase(client: Sql, manifest: Manifest) {
	if (manifest.scope !== 'sweep') return
	check(manifest.createdDatabase, 'Verifier did not create this database')
	const [row] =
		await client`SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = ${manifest.database}`
	check(row?.marker === marker(manifest), 'Isolated database ownership marker mismatch')
}
async function snapshot(client: Sql, f: Fixture): Promise<Snapshot> {
	const result: Snapshot = {
		online_hosts: [],
		host_aliases: [],
		agent_slash_commands: [],
		sessions: [],
		provider_login_requests: [],
		conversation_events: [],
	}
	for (const table of ['online_hosts', 'host_aliases', 'agent_slash_commands'] as const) {
		const rows = await client`SELECT to_jsonb(t)::text AS row FROM ${client(table)} t
			WHERE host_id = ${f.hostId} AND organization_id = ${f.organizationId} AND user_id = ${f.userId} ORDER BY to_jsonb(t)::text`
		result[table] = rows.map((r) => String(r.row))
	}
	for (const [table, id] of [
		['sessions', f.sessionId],
		['provider_login_requests', f.loginId],
		['conversation_events', f.eventId],
	] as const) {
		const rows =
			await client`SELECT to_jsonb(t)::text AS row FROM ${client(table)} t WHERE id = ${id} ORDER BY to_jsonb(t)::text`
		result[table] = rows.map((r) => String(r.row))
	}
	return result
}
async function seed(identity: Awaited<ReturnType<typeof stackIdentity>>, handoff: boolean) {
	check(!values.manifest, 'Seed creates a new manifest; do not supply --manifest')
	const scope = handoff ? 'ui' : z.enum(['sweep', 'ui']).parse(values.scope)
	if (scope === 'ui') {
		check(
			values['user-id']?.startsWith('user_'),
			'UI scope requires explicit authenticated WorkOS --user-id user_...',
		)
		check(
			values['organization-id'] === identity.status.localOrganization.id,
			'UI --organization-id must match stack local organization UUID',
		)
	}
	const run = randomUUID()
	const manifest: Manifest = {
		version: 1,
		run,
		stack: identity.status.id,
		checkout,
		composeProject: identity.status.composeProject,
		port: identity.status.postgres.postgresPort,
		serverId: identity.serverId,
		scope,
		database: scope === 'sweep' ? `host_cleanup_${run.replaceAll('-', '')}` : 'electric',
		now: Date.now(),
		createdDatabase: false,
		cleaned: false,
		seeded: false,
		ownedOrganizations: [],
		fixtures: [],
		baseline: {},
		deleted: [],
		refreshed: [],
		sweeps: [],
	}
	const path = manifestPath(run)
	await save(path, manifest, true)
	console.log(`Manifest: ${path}`)
	if (scope === 'sweep') {
		await scoped(databaseUrl(identity.url, 'postgres'), async (admin) => {
			await admin.unsafe(`CREATE DATABASE "${manifest.database}"`)
			try {
				await admin.unsafe(
					`COMMENT ON DATABASE "${manifest.database}" IS '${marker(manifest).replaceAll("'", "''")}'`,
				)
				manifest.createdDatabase = true
				await save(path, manifest)
			} catch (error) {
				// CREATE succeeded in this process; no pre-existing database can reach this branch.
				await admin.unsafe(`DROP DATABASE "${manifest.database}"`)
				throw error
			}
		})
	}
	await scoped(databaseUrl(identity.url, manifest.database), async (client) => {
		await verifyDatabase(client, manifest)
		const connection = await createDatabaseConnection(databaseUrl(identity.url, manifest.database))
		try {
			const db = connection.db
			if (scope === 'sweep') {
				await db.execute('CREATE SCHEMA IF NOT EXISTS "drizzle"')
				await migrate(db, { migrationsFolder })
			}
			const org = scope === 'ui' ? identity.status.localOrganization.id : randomUUID()
			const otherOrg = scope === 'sweep' ? randomUUID() : org
			if (scope === 'sweep') manifest.ownedOrganizations = [org, otherOrg]
			else {
				const [row] = await client`SELECT workos_organization_id FROM organizations WHERE id = ${org}`
				check(
					row?.workos_organization_id === identity.status.localOrganization.workosOrganizationId,
					'App organization does not match stack WorkOS organization',
				)
			}
			const user = scope === 'ui' ? values['user-id'] : `user_${randomUUID()}`
			check(user, 'Missing UI user identity')
			type Spec = {
				name: string
				age: number
				ephemeral?: boolean
				status?: 'online' | 'offline'
				remove?: boolean
				org?: string
				user?: string
				host?: string
			}
			const targetId = `verify-${run}-eligible`
			const specs: Spec[] =
				scope === 'sweep'
					? [
							{ name: 'eligible', age: 600_001, ephemeral: true, remove: true },
							{
								name: 'expired-offline-ephemeral',
								age: 600_001,
								ephemeral: true,
								status: 'offline',
								remove: true,
							},
							{ name: 'fresh-ephemeral', age: 0, ephemeral: true },
							{ name: 'ephemeral-cutoff', age: 600_000, ephemeral: true },
							{ name: 'ephemeral-after-cutoff', age: 599_999, ephemeral: true },
							{ name: 'ancient', age: 7_776_000_001, status: 'offline', remove: true },
							{ name: 'offline-cutoff', age: 7_776_000_000, status: 'offline' },
							{ name: 'recent-ordinary', age: 0 },
							{ name: 'other-user', age: 0, user: `user_${randomUUID()}`, host: targetId },
							{ name: 'other-organization', age: 0, org: otherOrg, host: targetId },
						]
					: [
							{ name: 'eligible', age: 3_600_000, status: 'offline' },
							{ name: 'recent-offline', age: 0, status: 'offline' },
							...(handoff
								? []
								: [
										{ name: 'online', age: 0, status: 'online' as const },
										...['fallback', 'race', 'cli'].map((name) => ({
											name,
											age: 3_600_000,
											status: 'offline' as const,
										})),
										{ name: 'other-user', age: 0, user: `user_${randomUUID()}`, host: targetId },
									]),
						]
			manifest.fixtures = specs.map((s) => ({
				name: s.name,
				hostId: s.host ?? `verify-${run}-${s.name}`,
				organizationId: s.org ?? org,
				userId: s.user ?? user,
				sweepDelete: s.remove ?? false,
				sessionId: randomUUID(),
				loginId: randomUUID(),
				eventId: randomUUID(),
			}))
			// Persist ownership before writes so a failed seed is still safely cleanable.
			await save(path, manifest)
			await db.transaction(async (tx) => {
				if (scope === 'sweep')
					await tx.insert(organizations).values(
						manifest.ownedOrganizations.map((id) => ({
							id,
							name: `Host cleanup ${run}`,
							workos_organization_id: `org_verify_${id}`,
						})),
					)
				for (const [index, f] of manifest.fixtures.entries()) {
					const spec = specs[index]
					check(spec, 'Missing fixture specification')
					const key = { host_id: f.hostId, organization_id: f.organizationId, user_id: f.userId }
					await tx.insert(onlineHosts).values({
						...key,
						host_name: `Verification ${f.name} (${run.slice(0, 8)})`,
						last_seen: BigInt(manifest.now - spec.age),
						status: spec.status ?? 'online',
						ephemeral: spec.ephemeral ?? false,
					})
					await tx
						.insert(hostAliases)
						.values({ ...key, display_name: `Verification ${f.name} (${run.slice(0, 8)})` })
					await tx.insert(agentSlashCommands).values(
						['claude', 'codex'].flatMap((agent) =>
							['', `/tmp/verify-${run}`].map((workspace_path) => ({
								...key,
								agent,
								workspace_path,
								commands: [{ name: 'verification', description: 'Run-owned verification command' }],
								skills: [],
							})),
						),
					)
					// There is no "completed" status: ready_for_input is the finished-turn historical state.
					await tx.insert(sessions).values({
						id: f.sessionId,
						host_id: f.hostId,
						organization_id: f.organizationId,
						created_by: f.userId,
						resource_owner_user_id: f.userId,
						coding_agent: 'claude',
						model: 'claude-sonnet-4-5',
						provider: 'anthropic',
						permissions_mode: 'default',
						status: 'ready_for_input',
						working_directory: `/tmp/verify-${run}`,
						title: `Verification history: ${f.name}`,
					})
					await tx.insert(conversationEvents).values({
						id: f.eventId,
						session_id: f.sessionId,
						organization_id: f.organizationId,
						resource_owner_user_id: f.userId,
						event_type: 'message',
						role: 'assistant',
						content: `Preserved historical content for verification run ${run}.`,
					})
					await tx.insert(providerLoginRequests).values({
						...key,
						id: f.loginId,
						provider: 'claude',
						status: 'succeeded',
						expires_at: BigInt(manifest.now + 86_400_000),
					})
				}
			})
			for (const f of manifest.fixtures) manifest.baseline[f.name] = await snapshot(client, f)
			manifest.seeded = true
			await save(path, manifest)
		} finally {
			await connection.close()
		}
	})
	console.log(
		json({
			manifest: path,
			database: manifest.database,
			scope,
			fixedInvocationTime: manifest.now,
			fixtures: manifest.fixtures,
			cleanup: `bun --bun scripts/verify-host-cleanup.ts cleanup --stack ${manifest.stack} --manifest ${path}`,
		}),
	)
}

async function assertState(client: Sql, manifest: Manifest, deleted: Set<string>, sweep: boolean) {
	for (const f of manifest.fixtures) {
		const baseline = manifest.baseline[f.name]
		check(baseline, `Missing baseline for ${f.name}`)
		const actual = await snapshot(client, f)
		const expected = structuredClone(baseline)
		if (deleted.has(f.name)) {
			expected.online_hosts = []
			expected.host_aliases = []
			expected.agent_slash_commands = []
		} else if (sweep) {
			// The existing stale-daemon pass legitimately changes only stored status on old survivors.
			expected.online_hosts = expected.online_hosts.map((row) => {
				const host = z.record(z.string(), z.unknown()).parse(JSON.parse(row))
				if (Number(host.last_seen) < manifest.now - 120_000) host.status = 'offline'
				return JSON.stringify(host)
			})
		} else if (f.name === 'race' && manifest.refreshed.includes('race')) {
			check(actual.online_hosts.length === 1, 'Refreshed race registration is missing')
			const host = z
				.object({ status: z.literal('online'), last_seen: z.number().int() })
				.parse(JSON.parse(actual.online_hosts[0] ?? 'null'))
			check(
				host.last_seen >= manifest.now && host.last_seen >= Date.now() - 15 * 60_000,
				'Refreshed race must have a recent heartbeat after seed',
			)
			// A real heartbeat updates capabilities/version/name too. Only this explicit target
			// may change registration fields; snapshot selected its full identity above.
			expected.online_hosts = actual.online_hosts
		}
		// Compare parsed JSON: PostgreSQL jsonb text whitespace is not significant.
		const canonical = (snapshot: Snapshot) =>
			json(
				Object.fromEntries(
					Object.entries(snapshot).map(([table, rows]) => [table, rows.map((row) => JSON.parse(row))]),
				),
			)
		check(
			canonical(actual) === canonical(expected),
			`Database assertion failed for ${f.name} (${f.hostId}, ${f.organizationId}, ${f.userId}); expected ${deleted.has(f.name) ? 'registration/cache deletion and exact history preservation' : 'exact preservation'}`,
		)
		console.log(
			`PASS ${f.name}: registration=${actual.online_hosts.length}, alias=${actual.host_aliases.length}, commands=${actual.agent_slash_commands.length}, history/session/login/event preserved`,
		)
	}
}

async function main() {
	if (values.help) {
		console.log(HELP)
		return
	}
	check(positionals.length === 1, HELP)
	const operation = positionals[0]
	check(
		['seed', 'sweep', 'assert-sweep', 'assert-delete', 'prepare-handoff', 'cleanup'].includes(operation ?? ''),
		HELP,
	)
	const identity = await stackIdentity()
	if (operation === 'seed' || operation === 'prepare-handoff') return seed(identity, operation === 'prepare-handoff')
	const { path, manifest } = await loadManifest(identity)
	if (manifest.cleaned) {
		check(operation === 'cleanup', 'Run has already been cleaned')
		console.log('Already cleaned')
		return
	}
	if (operation === 'cleanup' && manifest.scope === 'sweep') {
		await scoped(databaseUrl(identity.url, 'postgres'), async (admin) => {
			await verifyDatabase(admin, manifest)
			// No FORCE or backend termination: other clients must release their resources first.
			await admin.unsafe(`DROP DATABASE "${manifest.database}"`)
		})
	} else {
		check(operation === 'cleanup' || manifest.seeded, 'Seed did not complete; use cleanup')
		await scoped(databaseUrl(identity.url, manifest.database), async (client) => {
			await verifyDatabase(client, manifest)
			if (operation === 'sweep') {
				check(manifest.scope === 'sweep' && manifest.createdDatabase, 'Refusing to sweep UI/app database')
				const probe = await createDatabaseConnection(databaseUrl(identity.url, manifest.database))
				try {
					const statement = await probe.db.execute('SHOW statement_timeout')
					const lock = await probe.db.execute('SHOW lock_timeout')
					check(
						statement[0]?.statement_timeout === '10s' && lock[0]?.lock_timeout === '1s',
						'Production sweeper connection timeouts do not match expected safety limits',
					)
					console.log('PASS production connection: statement_timeout=10s, lock_timeout=1s')
				} finally {
					await probe.close()
				}
				const result = await runStaleDaemonSweep({
					now: () => manifest.now,
					loadDatabaseUrl: async () => databaseUrl(identity.url, manifest.database),
				})
				manifest.sweeps.push({
					ephemeral: result.expiredEphemeralHosts.registrationsDeleted,
					offline: result.expiredOfflineHosts.registrationsDeleted,
				})
				await save(path, manifest)
				console.log(json(result))
			} else if (operation === 'assert-sweep') {
				check(manifest.scope === 'sweep' && manifest.sweeps.length > 0, 'assert-sweep requires a sweep run')
				for (const [index, counts] of manifest.sweeps.entries()) {
					check(
						counts.ephemeral === (index === 0 ? 2 : 0) && counts.offline === (index === 0 ? 1 : 0),
						`Unexpected sweep counts at invocation ${index + 1}`,
					)
				}
				await assertState(
					client,
					manifest,
					new Set(manifest.fixtures.filter((f) => f.sweepDelete).map((f) => f.name)),
					true,
				)
			} else if (operation === 'assert-delete') {
				check(manifest.scope === 'ui', 'assert-delete requires a UI run')
				check(
					values.target && ['eligible', 'fallback', 'race', 'cli', 'none'].includes(values.target),
					'--target eligible|fallback|race|cli|none is required',
				)
				const deleted = new Set(manifest.deleted)
				if (values['refreshed-target']) {
					check(
						values['refreshed-target'] === 'race' &&
							values.target === 'none' &&
							manifest.fixtures.some((f) => f.name === 'race') &&
							!deleted.has('race'),
						'--refreshed-target race requires --target none and a surviving race fixture',
					)
					manifest.refreshed = ['race']
				}
				if (values.target !== 'none') {
					check(
						manifest.fixtures.some((f) => f.name === values.target),
						'Target is not in this run',
					)
					deleted.add(values.target)
				}
				await assertState(client, manifest, deleted, false)
				manifest.deleted = [...deleted]
				await save(path, manifest)
			} else if (operation === 'cleanup') {
				check(manifest.scope === 'ui', 'Invalid cleanup scope')
				await client.begin(async (tx) => {
					for (const f of manifest.fixtures) {
						for (const table of ['agent_slash_commands', 'host_aliases', 'online_hosts']) {
							await tx`DELETE FROM ${tx(table)} WHERE host_id = ${f.hostId} AND organization_id = ${f.organizationId} AND user_id = ${f.userId}`
						}
						await tx`DELETE FROM conversation_events WHERE id = ${f.eventId} AND session_id = ${f.sessionId} AND organization_id = ${f.organizationId}`
						await tx`DELETE FROM provider_login_requests WHERE id = ${f.loginId} AND host_id = ${f.hostId} AND organization_id = ${f.organizationId} AND user_id = ${f.userId}`
						await tx`DELETE FROM sessions WHERE id = ${f.sessionId} AND host_id = ${f.hostId} AND organization_id = ${f.organizationId} AND resource_owner_user_id = ${f.userId}`
					}
				})
				for (const f of manifest.fixtures) {
					const remaining = await snapshot(client, f)
					check(
						Object.values(remaining).every((rows) => rows.length === 0),
						`Cleanup left rows for ${f.name}`,
					)
				}
			}
		})
	}
	if (operation === 'cleanup') {
		manifest.cleaned = true
		await save(path, manifest)
		console.log(`Cleaned ${path}`)
	}
}

try {
	await main()
} catch (error) {
	// Avoid leaking connection URLs/passwords through database or schema errors.
	console.error(
		error instanceof z.ZodError
			? 'Invalid or missing devstack status/manifest/arguments; run --help and devstack status'
			: error instanceof Error
				? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted database URL]')
				: 'Verification failed',
	)
	process.exitCode = 1
}

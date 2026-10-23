import { describe, expect, it } from 'vitest'

import {
	DEVSTACK_ENV_END,
	DEVSTACK_ENV_START,
	isDevstackEnvBlockFresh,
	replaceDevstackEnvBlock,
	removeDevstackEnvBlock,
	renderStackEnvLines,
	stackLogDirectory,
} from '../lib/env-block'

describe.skipIf(Boolean(process.env.CI))('devstack env projection', () => {
	it('reports freshness only for an exact generated block', () => {
		const lines = ['DEVSTACK_ID=stack-one', 'DEVSTACK_REGISTRY_PATH=/tmp/registry.json']
		const current = replaceDevstackEnvBlock('MANUAL=value\n', lines)

		expect(isDevstackEnvBlockFresh(current, lines)).toBe(true)
		expect(isDevstackEnvBlockFresh(current, [...lines, 'RIPTIDE_API_PORT=3000'])).toBe(false)
		expect(isDevstackEnvBlockFresh('MANUAL=value\n', lines)).toBe(false)
	})

	it('appends exactly one block without changing manual values', () => {
		const result = replaceDevstackEnvBlock('SECRET=keep-me\n', ['DEVSTACK_ID=alpha'])
		expect(result).toContain('SECRET=keep-me')
		expect(result.match(new RegExp(DEVSTACK_ENV_START, 'g'))).toHaveLength(1)
		expect(result).toContain('DEVSTACK_ID=alpha')
	})

	it('replaces unmanaged daemon organization IDs with the generated value', () => {
		const existing = 'SECRET=keep-me\nRIPTIDE_DAEMON_ORGANIZATION_ID=stale\n'
		const lines = ['RIPTIDE_DAEMON_ORGANIZATION_ID=current']
		const result = replaceDevstackEnvBlock(existing, lines)

		expect(result).toContain('SECRET=keep-me')
		expect(result.match(/RIPTIDE_DAEMON_ORGANIZATION_ID=/g)).toHaveLength(1)
		expect(result).toContain('RIPTIDE_DAEMON_ORGANIZATION_ID=current')
		expect(isDevstackEnvBlockFresh(result, lines)).toBe(true)
	})

	it('treats an unmanaged daemon organization override as stale', () => {
		const lines = ['RIPTIDE_DAEMON_ORGANIZATION_ID=current']
		const current = replaceDevstackEnvBlock('', lines)
		expect(isDevstackEnvBlockFresh(`RIPTIDE_DAEMON_ORGANIZATION_ID=stale\n${current}`, lines)).toBe(false)
	})

	it('replaces a well-formed block and preserves surrounding text', () => {
		const existing = `BEFORE=yes\n${DEVSTACK_ENV_START}\nDEVSTACK_ID=old\n${DEVSTACK_ENV_END}\nAFTER=yes\n`
		const result = replaceDevstackEnvBlock(existing, ['DEVSTACK_ID=new'])
		expect(result).toContain('BEFORE=yes')
		expect(result).toContain('AFTER=yes')
		expect(result).toContain('DEVSTACK_ID=new')
		expect(result).not.toContain('DEVSTACK_ID=old')
	})

	it('refuses partial or duplicate generated blocks', () => {
		expect(() => replaceDevstackEnvBlock(`${DEVSTACK_ENV_START}\nDEVSTACK_ID=bad`, [])).toThrow('malformed')
		expect(() =>
			replaceDevstackEnvBlock(
				`${DEVSTACK_ENV_START}\n${DEVSTACK_ENV_END}\n${DEVSTACK_ENV_START}\n${DEVSTACK_ENV_END}`,
				[],
			),
		).toThrow('multiple')
	})

	it('renders stable environment names for camel-cased ports', () => {
		expect(
			renderStackEnvLines(
				{
					id: 'alpha',
					composeProject: 'riptide-alpha',
					tabColor: '#d0679d',
					ports: {
						api: 8701,
						ui: 3001,
						cloud: 5175,
						electric: 3031,
						electricProxy: 8889,
						rivetEngine: 4438,
						rivetServices: 4439,
						tanstackDevtools: 42072,
						minioApi: 1234,
						minioConsole: 1235,
						postgres: 5432,
					},
					postgres: {
						postgresPort: 5432,
						postgresPassword: 'secret',
						postgresVolume: 'riptide-alpha-postgres',
						databaseUrl: 'postgresql://postgres:secret@127.0.0.1:5432/electric',
						readReplicaDatabaseUrl: 'postgresql://postgres:secret@127.0.0.1:5432/electric',
					},
				},
				'/tmp/registry.json',
				'internal-org-id',
			),
		).toEqual([
			'DEVSTACK_ID=alpha',
			'DEVSTACK_REGISTRY_PATH=/tmp/registry.json',
			`LOG_BASE=${stackLogDirectory('alpha')}`,
			'DEVSTACK_COMPOSE_PROJECT=riptide-alpha',
			'DEVSTACK_POSTGRES_PORT=5432',
			'DEVSTACK_POSTGRES_PASSWORD=secret',
			'DEVSTACK_POSTGRES_VOLUME=riptide-alpha-postgres',
			'DATABASE_URL=postgresql://postgres:secret@127.0.0.1:5432/electric',
			'READ_REPLICA_DATABASE_URL=postgresql://postgres:secret@127.0.0.1:5432/electric',
			'RIPTIDE_API_PORT=8701',
			'VITE_PUBLIC_RIPTIDE_API_ORIGIN=https://api.alpha.localhost',
			'RIPTIDE_API_ORIGIN=https://api.alpha.localhost',
			'RIPTIDE_UI_PORT=3001',
			'RIPTIDE_CLOUD_PORT=5175',
			'RIPTIDE_UI_TANSTACK_DEVTOOLS_PORT=42072',
			'VITE_PUBLIC_DEEP_LINK_SCHEME=riptide-local-alpha',
			'VITE_PUBLIC_CLOUD_ORIGIN=https://cloud.alpha.localhost',
			'CLOUD_ORIGIN=https://cloud.alpha.localhost',
			'VITE_ADMIN_API_ORIGIN=https://admin-api.alpha.localhost',
			'APP_ORIGIN=https://app.alpha.localhost',
			'RIPTIDE_ELECTRON_RENDERER_URL=https://app.alpha.localhost',
			'DEVSTACK_ELECTRIC_PORT=3031',
			'DEVSTACK_ELECTRIC_SECRET=',
			'DEVSTACK_ELECTRIC_REPLICATION_STREAM_ID=alpha',
			'RIPTIDE_ELECTRIC_PROXY_PORT=8889',
			'ELECTRIC_SHAPE_URL=http://127.0.0.1:3031/v1/shape',
			'ELECTRIC_SECRET=',
			'VITE_PUBLIC_SYNC_ORIGIN=https://sync.alpha.localhost',
			'RIPTIDE_SYNC_ORIGIN=https://sync.alpha.localhost',
			'RIPTIDE_APP_ORIGIN=https://app.alpha.localhost',
			'VITE_PUBLIC_DEVSTACK_ID=alpha',
			'VITE_PUBLIC_DEVSTACK_COLOR=d0679d',
			'VITE_PUBLIC_DEVSTACK_OVERRIDE_DEFAULT_CLAUDE_MODEL=haiku',
			'VITE_PUBLIC_BUILD_TYPE=local',
			'RIPTIDE_DAEMON_API_ORIGIN=https://api.alpha.localhost',
			'RIPTIDE_DAEMON_SYNC_ORIGIN=https://sync.alpha.localhost',
			'RIPTIDE_DAEMON_CLOUD_ORIGIN=https://cloud.alpha.localhost',
			'RIPTIDE_DAEMON_APP_ORIGIN=https://app.alpha.localhost',
			'DEVSTACK_DURABLE_STREAMS_PORT=4439',
			'DEVSTACK_DURABLE_STREAMS_VOLUME=riptide-alpha-durable-streams',
			'DURABLE_STREAMS_ORIGIN=http://127.0.0.1:4439',
			'DEVSTACK_MINIO_API_PORT=1234',
			'DEVSTACK_MINIO_CONSOLE_PORT=1235',
			'DEVSTACK_MINIO_VOLUME=riptide-alpha-minio',
			'S3_ARTIFACTS_ENDPOINT=http://127.0.0.1:1234',
			'S3_ARTIFACTS_BUCKET=riptide-artifacts',
			'S3_ACCESS_KEY_ID=minioadmin',
			'S3_SECRET_ACCESS_KEY=minioadmin',
			'RIPTIDE_DAEMON_ORGANIZATION_ID=internal-org-id',
			'DEVSTACK_API_PORT=8701',
		])
	})

	it('removes only the generated block', () => {
		const existing = `SECRET=keep\n\n${DEVSTACK_ENV_START}\nDEVSTACK_ID=alpha\n${DEVSTACK_ENV_END}\nAFTER=keep\n`
		expect(removeDevstackEnvBlock(existing)).toBe('SECRET=keep\nAFTER=keep\n')
		expect(removeDevstackEnvBlock('SECRET=keep\n')).toBe('SECRET=keep\n')
	})

	it('refuses to remove malformed generated blocks', () => {
		expect(() => removeDevstackEnvBlock(`${DEVSTACK_ENV_START}\nDEVSTACK_ID=bad`)).toThrow('malformed')
	})
})

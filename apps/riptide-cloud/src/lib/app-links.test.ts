import { afterEach, describe, expect, test, vi } from 'vitest'

import { appOrigin, taskAppUrl } from './app-links'

/**
 * `env` reads `import.meta.env` at module load, so each case re-imports the
 * module under a stubbed value rather than mutating a frozen object.
 */
async function withOrigin<T>(value: string | undefined, run: (m: typeof import('./app-links')) => T): Promise<T> {
	vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', value as string)
	vi.resetModules()
	const module = await import('./app-links')
	return run(module)
}

afterEach(() => {
	vi.unstubAllEnvs()
	vi.resetModules()
})

describe('appOrigin', () => {
	test('returns the configured origin', async () => {
		await withOrigin('https://app.dev.codelayer.gg', (m) =>
			expect(m.appOrigin()).toBe('https://app.dev.codelayer.gg'),
		)
	})

	test('strips trailing slashes so the joined path has exactly one', async () => {
		await withOrigin('https://app.dev.codelayer.gg//', (m) =>
			expect(m.taskAppUrl('abc')).toBe('https://app.dev.codelayer.gg/tasks/abc'),
		)
	})

	test('is null when unset, so callers fall back inside this app', async () => {
		await withOrigin(undefined, (m) => {
			expect(m.appOrigin()).toBeNull()
			expect(m.taskAppUrl('abc')).toBeNull()
		})
	})

	test('is null for a blank value rather than building "/tasks/id"', async () => {
		await withOrigin('   ', (m) => expect(m.appOrigin()).toBeNull())
	})

	/**
	 * The case that motivated the check. A scheme-less origin yields
	 * `href="localhost:3000/tasks/x"`, which the browser resolves RELATIVE to
	 * the current page — navigating to `/admin/localhost:3000/tasks/x` inside
	 * riptide-cloud instead of leaving for the app. A silently wrong link is
	 * worse than no link, so this must be null.
	 */
	test('is null for a scheme-less origin, which would resolve as a relative path', async () => {
		await withOrigin('localhost:3000', (m) => expect(m.appOrigin()).toBeNull())
		await withOrigin('app.dev.codelayer.gg', (m) => expect(m.appOrigin()).toBeNull())
	})

	test('is null for a non-http scheme, which must never reach an href', async () => {
		await withOrigin('javascript:alert(1)', (m) => expect(m.appOrigin()).toBeNull())
		await withOrigin('data:text/html,hi', (m) => expect(m.appOrigin()).toBeNull())
	})
})

describe('taskAppUrl', () => {
	test('builds the riptide-ui task path', async () => {
		await withOrigin('https://app.dev.codelayer.gg', (m) =>
			expect(m.taskAppUrl('019c2700-0000-7000-8000-000000000002')).toBe(
				'https://app.dev.codelayer.gg/tasks/019c2700-0000-7000-8000-000000000002',
			),
		)
	})

	test('encodes the id so a hostile value cannot escape the path', async () => {
		await withOrigin('https://app.dev.codelayer.gg', (m) =>
			expect(m.taskAppUrl('../admin?x=1')).toBe('https://app.dev.codelayer.gg/tasks/..%2Fadmin%3Fx%3D1'),
		)
	})
})

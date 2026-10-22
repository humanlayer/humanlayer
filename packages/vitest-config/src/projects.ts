import type { TestProjectInlineConfiguration } from 'vitest/config'

type ProjectTestOptions = NonNullable<TestProjectInlineConfiguration['test']>

/**
 * Build `test.projects` entries for suite splits (unit / learning / eval / e2e ...).
 *
 * Each project inherits the package's root config (`extends: true`) and gets its
 * record key as the project name, so package scripts can run
 * `vitest run --project unit` in CI while `--project learning` stays manual.
 *
 * Usage:
 * ```ts
 * export default mergeConfig(
 *   base,
 *   defineConfig({
 *     test: {
 *       projects: projects({
 *         unit: { include: ['test/*.test.ts'] },
 *         learning: { include: ['test/learning/*.test.ts'], testTimeout: 120_000 },
 *       }),
 *     },
 *   }),
 * )
 * ```
 */
export function projects(defs: Record<string, Omit<ProjectTestOptions, 'name'>>): TestProjectInlineConfiguration[] {
	return Object.entries(defs).map(([name, test]) => ({
		extends: true,
		test: { ...test, name },
	}))
}

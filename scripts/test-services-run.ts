import { serviceTestConcurrency } from '../ci-scripts/service-test-concurrency'

const concurrency = serviceTestConcurrency(process.env.SERVICE_TEST_CONCURRENCY)
const servicesStarted = performance.now()
const child = Bun.spawn(
	[
		'bun',
		'--env-file=.env',
		'turbo',
		'run',
		'test',
		'--filter=@humanlayer/billing',
		'--filter=@humanlayer/riptide-api',
		'--filter=@humanlayer/test-fixtures',
		'--filter=@humanlayer/riptide-electric-proxy',
		'--filter=@humanlayer/stale-daemon-sweeper',
		`--concurrency=${concurrency}`,
	],
	{
		stdout: 'inherit',
		stderr: 'inherit',
	},
)

const exitCode = await child.exited
console.log(
	`[test-services] package tests (concurrency=${concurrency}): ${((performance.now() - servicesStarted) / 1000).toFixed(1)}s (exit ${exitCode})`,
)
if (exitCode !== 0) process.exit(exitCode)

const daemonStarted = performance.now()
const daemonDatabaseTests = Bun.spawn(
	[
		'bun',
		'--env-file=.env',
		'vitest',
		'run',
		'--config',
		'apps/riptide-daemon/vitest.config.ts',
		'--project',
		'database',
	],
	{
		stdout: 'inherit',
		stderr: 'inherit',
	},
)

const daemonExitCode = await daemonDatabaseTests.exited
console.log(
	`[test-services] daemon database tests: ${((performance.now() - daemonStarted) / 1000).toFixed(1)}s (exit ${daemonExitCode})`,
)
process.exit(daemonExitCode)

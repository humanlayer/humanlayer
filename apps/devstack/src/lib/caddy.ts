import { execFile, spawn } from 'node:child_process'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { request as httpsRequest } from 'node:https'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { readRegistry, type DevstackRegistry, type StackRecord } from './registry'

const execFileAsync = promisify(execFile)

async function runCaddy(args: string[], fallbackMessage: string): Promise<void> {
	try {
		await execFileAsync('caddy', args, { encoding: 'utf8' })
	} catch (error) {
		const failure = error as NodeJS.ErrnoException & { stderr?: string }
		if (failure.code === 'ENOENT') throw error
		throw new Error(failure.stderr?.trim() || fallbackMessage, { cause: error })
	}
}

export type CaddyState = { pid: number; configPath: string; startedAt: string }
export type CaddyStatus = { running: boolean; pid: number | null; configPath: string }
export type CaddyProcess = { pid: number; command: string }

const ROUTE_PORTS = {
	ui: 'ui',
	cloud: 'cloud',
	api: 'api',
	sync: 'electricProxy',
	docs: 'docs',
	adminApi: 'adminApi',
	adminUi: 'adminUi',
	s3: 'minioApi',
} as const

export function caddyConfigPath(registryPath: string): string {
	return join(dirname(registryPath), 'Caddyfile.generated')
}

export function caddyStatePath(registryPath: string): string {
	return join(dirname(registryPath), 'caddy-state.json')
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;')
}

function renderDevstackIndex(stacks: StackRecord[]): string {
	const cards = [...stacks]
		.sort((left, right) => left.id.localeCompare(right.id))
		.map((stack, index) => {
			const name = escapeHtml(stack.displayName || stack.id)
			const id = escapeHtml(stack.id)
			const app = escapeHtml(stack.routes.ui)
			const cloud = escapeHtml(stack.routes.cloud)
			const health = escapeHtml(`${stack.routes.api}/health`)
			return `<article style="--i:${index}" data-health-url="${health}" data-health-state="checking"><div class="card-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</div><div class="stack-info"><div class="status" data-state="checking"><span></span><span class="status-text">checking</span></div><h2>${name}</h2><code>${id}</code></div><nav aria-label="${name} destinations"><a class="app" href="${app}" target="_blank" rel="noopener noreferrer"><span>Launch app</span><b aria-hidden="true">&#8599;</b></a><a href="${cloud}" target="_blank" rel="noopener noreferrer"><span>Open cloud</span><b aria-hidden="true">&#8599;</b></a></nav></article>`
		})
		.join('\n')
	const content =
		cards ||
		'<div class="empty"><span aria-hidden="true">&empty;</span><p>No devstacks are currently registered.</p><code>Run devstack start to bring one online.</code></div>'
	const stackCount = stacks.length
	return `<!doctype html>
<html lang="en" data-theme="poimandres-vscode">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%2310120f'/%3E%3Cpath d='M18 16h14c10 0 17 6 17 16S42 48 32 48H18V16Zm9 8v16h5c6 0 9-3 9-8s-3-8-9-8h-5Z' fill='%23d6ff38'/%3E%3C/svg%3E">
<title>devstk</title>
<style>
:root { color-scheme: dark; font-family: "Iosevka", "Berkeley Mono", "IBM Plex Mono", monospace; --ink: #10120f; --paper: #e8e4d8; --acid: #d6ff38; --signal: #ff5c35; --muted: #a7aa9d; --line: #41443d; }
* { box-sizing: border-box; }
html { min-height: 100%; background: var(--ink); }
body { margin: 0; min-height: 100vh; overflow-x: hidden; background-color: var(--ink); background-image: linear-gradient(rgba(232,228,216,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(232,228,216,.045) 1px, transparent 1px); background-size: 2.5rem 2.5rem; color: var(--paper); }
body::before { position: fixed; z-index: -1; top: -12rem; right: -8rem; width: 32rem; height: 32rem; border: 1px solid var(--line); border-radius: 50%; box-shadow: 0 0 0 5rem rgba(214,255,56,.025), 0 0 0 10rem rgba(214,255,56,.015); content: ""; }
main { width: min(72rem, calc(100% - 3rem)); margin: 0 auto; padding: clamp(3rem, 8vw, 7rem) 0 4rem; }
header { display: grid; grid-template-columns: 1fr auto; gap: 2rem; align-items: end; margin-bottom: 3rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--line); animation: reveal .5s ease-out both; }
.eyebrow { display: flex; align-items: center; gap: .75rem; margin: 0 0 1rem; color: var(--acid); font-size: .7rem; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; }
.eyebrow::before { width: 2rem; height: 2px; background: var(--acid); content: ""; }
h1 { max-width: 9ch; margin: 0; color: var(--paper); font-size: clamp(3.5rem, 10vw, 8rem); font-weight: 800; line-height: .78; letter-spacing: -.09em; text-transform: uppercase; }
h1 span { display: block; margin-left: .72em; color: transparent; -webkit-text-stroke: 1px var(--paper); }
.overview { min-width: 11rem; padding: 1rem; border: 1px solid var(--line); background: rgba(16,18,15,.75); }
.overview strong { display: block; color: var(--acid); font-size: 2.5rem; line-height: 1; }
.overview span { display: block; margin-top: .5rem; color: var(--muted); font-size: .65rem; letter-spacing: .12em; text-transform: uppercase; }
.stacks { display: grid; gap: 1px; border: 1px solid var(--line); background: var(--line); }
article { position: relative; display: grid; grid-template-columns: 3.5rem minmax(0, 1fr) auto; align-items: stretch; min-height: 9rem; background: rgba(16,18,15,.96); animation: reveal .45s calc(.08s * var(--i) + .12s) ease-out both; transition: background .2s ease; }
article[data-health-state="online"] { order: -1; }
article[data-health-state="offline"] nav { display: none; }
article:hover { background: #181b16; }
.card-index { display: grid; place-items: center; border-right: 1px solid var(--line); color: var(--muted); font-size: .65rem; writing-mode: vertical-rl; }
.stack-info { align-self: center; min-width: 0; padding: 1.5rem 2rem; }
.status { display: flex; align-items: center; gap: .45rem; margin-bottom: .85rem; color: var(--acid); font-size: .6rem; letter-spacing: .15em; text-transform: uppercase; }
.status > span:first-child { width: .45rem; height: .45rem; border-radius: 50%; background: currentColor; box-shadow: 0 0 .75rem currentColor; }
.status[data-state="checking"] { color: var(--muted); }
.status[data-state="offline"] { color: var(--signal); }
h2 { overflow: hidden; margin: 0 0 .55rem; color: var(--paper); font-size: clamp(1.35rem, 3vw, 2rem); font-weight: 700; letter-spacing: -.045em; text-overflow: ellipsis; white-space: nowrap; }
code { color: var(--muted); font-family: inherit; font-size: .68rem; }
nav { display: grid; grid-template-columns: repeat(2, minmax(8.5rem, 1fr)); min-width: 20rem; }
a { display: flex; flex-direction: column; justify-content: space-between; gap: 1rem; padding: 1.25rem; border-left: 1px solid var(--line); background: transparent; color: var(--paper); text-decoration: none; font-size: .68rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; transition: color .18s ease, background .18s ease; }
a b { align-self: flex-end; font-size: 1.5rem; font-weight: 400; transition: transform .18s ease; }
a:hover, a:focus-visible { outline: none; background: var(--paper); color: var(--ink); }
a:hover b, a:focus-visible b { transform: translate(.2rem, -.2rem); }
a.app { background: var(--acid); color: var(--ink); }
a.app:hover, a.app:focus-visible { background: var(--signal); }
.empty { display: grid; justify-items: center; gap: .75rem; padding: 5rem 2rem; background: var(--ink); text-align: center; }
.empty > span { color: var(--acid); font-size: 3rem; line-height: 1; }
.empty p { margin: 0; font-size: 1rem; }
.empty code { color: var(--muted); }
footer { display: flex; justify-content: space-between; gap: 1rem; margin-top: 1rem; color: var(--muted); font-size: .6rem; letter-spacing: .08em; text-transform: uppercase; }
@keyframes reveal { from { opacity: 0; transform: translateY(1rem); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; } }
@media (max-width: 48rem) { main { width: min(100% - 1.5rem, 36rem); padding-top: 2rem; } header { grid-template-columns: 1fr; } .overview { display: flex; align-items: baseline; gap: .75rem; } article { grid-template-columns: 2.5rem minmax(0, 1fr); } .stack-info { padding: 1.25rem; } nav { grid-column: 1 / -1; min-width: 0; border-top: 1px solid var(--line); } a:first-child { border-left: 0; } h1 { font-size: clamp(3.25rem, 20vw, 6rem); } footer { flex-direction: column; } }
</style>
</head>
<body><main><header><div><p class="eyebrow">Local environment control</p><h1>Dev<span>stacks</span></h1></div><div class="overview"><strong>${stackCount}</strong><span>registered ${stackCount === 1 ? 'stack' : 'stacks'}</span></div></header><section class="stacks" aria-label="Registered devstacks">${content}</section><footer><span>Routing via Caddy</span><span>devstack.localhost</span></footer></main><script>
for (const card of document.querySelectorAll('[data-health-url]')) {
  const status = card.querySelector('.status')
  const text = status.querySelector('.status-text')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2000)
  fetch(card.getAttribute('data-health-url'), { signal: controller.signal })
    .then((response) => {
      const state = response.ok ? 'online' : 'offline'
      card.dataset.healthState = state
      status.dataset.state = state
      text.textContent = state
    })
    .catch(() => {
      card.dataset.healthState = 'offline'
      status.dataset.state = 'offline'
      text.textContent = 'offline'
    })
    .finally(() => clearTimeout(timeout))
}
</script></body>
</html>`
}

export function renderCaddyConfig(stacks: StackRecord[]): string {
	const routeBlocks = [...stacks]
		.sort((left, right) => left.id.localeCompare(right.id))
		.flatMap((stack) =>
			Object.entries(ROUTE_PORTS).flatMap(([routeName, portName]) => {
				const route = stack.routes[routeName as keyof typeof ROUTE_PORTS]
				// Records written before a route existed (e.g. s3) regain it on their next sync.
				if (!route) return []
				const backend =
					routeName === 'api'
						? (stack.api?.backend ?? `127.0.0.1:${stack.ports.api}`)
						: routeName === 'sync'
							? (stack.electric?.proxyBackend ?? `127.0.0.1:${stack.ports.electricProxy}`)
							: `127.0.0.1:${stack.ports[portName]}`
				return [
					`${route} {\n\treverse_proxy ${backend} {\n\t\tflush_interval -1\n\t}\n\theader Cache-Control "no-cache, no-transform"\n\theader X-Accel-Buffering "no"\n}`,
				]
			}),
		)
	const index = `https://devstack.localhost {
\theader Content-Type "text/html; charset=utf-8"
\trespond <<HTML
${renderDevstackIndex(stacks)}
HTML 200
}`
	return `# Generated by devstack. Do not edit.\n\n${index}${routeBlocks.length ? `\n\n${routeBlocks.join('\n\n')}` : ''}\n`
}

export async function regenerateCaddyConfig(
	registryPath: string,
	registry: DevstackRegistry,
	options: { reload?: boolean } = {},
): Promise<void> {
	const configPath = caddyConfigPath(registryPath)
	await mkdir(dirname(configPath), { recursive: true })
	const temporaryPath = `${configPath}.${process.pid}.${crypto.randomUUID()}.tmp`
	await writeFile(temporaryPath, renderCaddyConfig(Object.values(registry.stacks)), { mode: 0o600 })
	await rename(temporaryPath, configPath)
	const state = await readState(registryPath)
	if (!state?.pid || !processIsRunning(state.pid)) {
		await writeFile(
			caddyStatePath(registryPath),
			`${JSON.stringify({ active: Object.keys(registry.stacks).length > 0, configPath }, null, 2)}\n`,
			{ mode: 0o600 },
		)
	} else if (options.reload !== false) {
		await validateConfig(configPath)
		await runCaddy(
			['reload', '--force', '--config', configPath, '--address', 'localhost:2019'],
			'Caddy reload failed',
		)
	}
}

async function readState(registryPath: string): Promise<CaddyState | null> {
	try {
		return JSON.parse(await readFile(caddyStatePath(registryPath), 'utf8')) as CaddyState
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
		throw error
	}
}

function processIsRunning(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

export async function caddyStatus(
	registryPath: string,
	options: { repairStaleState?: boolean } = {},
): Promise<CaddyStatus> {
	const state = await readState(registryPath)
	const pid = state?.pid ?? null
	const running = Boolean(pid && processIsRunning(pid))
	if (state && !running && options.repairStaleState !== false) {
		await rm(caddyStatePath(registryPath), { force: true })
	}
	return { running, pid: running ? pid : null, configPath: caddyConfigPath(registryPath) }
}

export async function conflictingCaddyProcesses(registryPath: string): Promise<CaddyProcess[]> {
	const status = await caddyStatus(registryPath, { repairStaleState: false })
	const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
	return parseCaddyProcesses(stdout, status.pid)
}

export function parseCaddyProcesses(output: string, managedPid: number | null): CaddyProcess[] {
	return output
		.split('\n')
		.map((line) => {
			const match = /^(\d+)\s+(.+)$/.exec(line.trim())
			if (!match?.[1] || !match[2]) return null
			return { pid: Number(match[1]), command: match[2] }
		})
		.filter((process): process is CaddyProcess =>
			Boolean(process && /(?:^|\/)caddy\s+run(?:\s|$)/.test(process.command)),
		)
		.filter((process) => process.pid !== managedPid)
}

async function validateConfig(configPath: string): Promise<void> {
	await runCaddy(['validate', '--config', configPath], `Caddy config validation failed for ${configPath}`)
}

export async function startCaddy(registryPath: string): Promise<CaddyStatus> {
	const current = await caddyStatus(registryPath)
	if (current.running) return current
	await validateConfig(current.configPath)
	const logPath = join(dirname(registryPath), 'caddy.log')
	const logFile = await open(logPath, 'a', 0o600)
	const child = spawn('caddy', ['run', '--config', current.configPath], {
		detached: true,
		stdio: ['ignore', logFile.fd, logFile.fd],
	})
	await logFile.close()
	child.unref()
	if (!child.pid) throw new Error('Caddy did not return a process ID')
	await writeFile(
		caddyStatePath(registryPath),
		`${JSON.stringify({ pid: child.pid, configPath: current.configPath, startedAt: new Date().toISOString() }, null, 2)}\n`,
		{ mode: 0o600 },
	)
	await new Promise((resolve) => setTimeout(resolve, 250))
	const started = await caddyStatus(registryPath)
	if (!started.running) throw new Error(`Caddy exited during startup; inspect ${logPath}`)
	return started
}

export async function reloadCaddy(registryPath: string): Promise<CaddyStatus> {
	const status = await caddyStatus(registryPath)
	if (!status.running) return startCaddy(registryPath)
	await validateConfig(status.configPath)
	await runCaddy(
		['reload', '--force', '--config', status.configPath, '--address', 'localhost:2019'],
		'Caddy reload failed',
	)
	return caddyStatus(registryPath)
}

export type EnsureCaddyResult = CaddyStatus & { plannedAction: 'start' | 'reload' | 'none' }

type ExpectedRoute = { hostname: string; backend?: string }
type EnsureCaddyRuntime = {
	fetch: typeof fetch
	probeRoute: (hostname: string) => Promise<void>
	sleep: (milliseconds: number) => Promise<void>
	reload: typeof reloadCaddy
	start: typeof startCaddy
	restart: typeof restartCaddy
	status: typeof caddyStatus
}

function probeHttpsRoute(hostname: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = httpsRequest(
			{
				hostname,
				method: 'HEAD',
				path: '/',
				port: 443,
				rejectUnauthorized: false,
				timeout: 2_000,
			},
			(response) => {
				response.resume()
				resolve()
			},
		)
		request.once('error', reject)
		request.once('timeout', () => request.destroy(new Error(`Timed out probing https://${hostname}/`)))
		request.end()
	})
}

export type EnsureCaddyOptions = {
	dryRun?: boolean
	/** Runtime seams used by deterministic tests. */
	runtime?: Partial<EnsureCaddyRuntime>
	verification?: { timeoutMs?: number; retryMs?: number }
}

function expectedRoutes(registry: DevstackRegistry): ExpectedRoute[] {
	return [
		{ hostname: 'devstack.localhost' },
		...Object.values(registry.stacks).flatMap((stack) =>
			Object.entries(ROUTE_PORTS).flatMap(([routeName, portName]) => {
				const route = stack.routes[routeName as keyof typeof ROUTE_PORTS]
				if (!route) return []
				return [
					{
						hostname: new URL(route).hostname,
						backend:
							routeName === 'api'
								? (stack.api?.backend ?? `127.0.0.1:${stack.ports.api}`)
								: routeName === 'sync'
									? (stack.electric?.proxyBackend ?? `127.0.0.1:${stack.ports.electricProxy}`)
									: `127.0.0.1:${stack.ports[portName]}`,
					},
				]
			}),
		),
	]
}

function objectContainsRoute(value: unknown, route: ExpectedRoute): boolean {
	if (!value || typeof value !== 'object') return false
	const serialized = JSON.stringify(value)
	if (serialized.includes(`"${route.hostname}"`) && (!route.backend || serialized.includes(`"${route.backend}"`)))
		return true
	return Object.values(value).some((child) => objectContainsRoute(child, route))
}

async function verifyCaddy(
	routes: ExpectedRoute[],
	runtime: Pick<EnsureCaddyRuntime, 'fetch' | 'probeRoute' | 'sleep'>,
	options: { timeoutMs?: number; retryMs?: number } = {},
): Promise<void> {
	const timeoutMs = options.timeoutMs ?? 5_000
	const retryMs = options.retryMs ?? 100
	const deadline = Date.now() + timeoutMs
	let lastFailure = 'verification did not run'
	do {
		try {
			const adminResponse = await runtime.fetch('http://localhost:2019/config/')
			if (!adminResponse.ok) throw new Error(`admin API returned HTTP ${adminResponse.status}`)
			const activeConfig: unknown = await adminResponse.json()
			const missing = routes.filter((route) => !objectContainsRoute(activeConfig, route))
			if (missing.length) {
				throw new Error(
					`active config is missing ${missing.map((route) => `${route.hostname} -> ${route.backend}`).join(', ')}`,
				)
			}
			await Promise.all(routes.map((route) => runtime.probeRoute(route.hostname)))
			return
		} catch (error) {
			lastFailure = error instanceof Error ? error.message : String(error)
		}
		if (Date.now() < deadline) await runtime.sleep(retryMs)
	} while (Date.now() < deadline)
	throw new Error(`Caddy verification did not converge: ${lastFailure}`)
}

async function restartCaddy(registryPath: string): Promise<CaddyStatus> {
	const state = await readState(registryPath)
	if (!state?.pid || !processIsRunning(state.pid)) {
		throw new Error('Cannot restart Caddy: this registry has no running recorded Caddy PID')
	}
	process.kill(state.pid, 'SIGTERM')
	const deadline = Date.now() + 5_000
	while (processIsRunning(state.pid) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
	if (processIsRunning(state.pid)) throw new Error(`Caddy PID ${state.pid} did not stop safely`)
	await rm(caddyStatePath(registryPath), { force: true })
	return startCaddy(registryPath)
}

/**
 * Idempotently converge Caddy to running against the current generated config: reload when it is
 * already up, start it otherwise. `regenerateCaddyConfig` has already written the config and the
 * desired-state file. `dryRun` reports the action without touching anything.
 */
export async function ensureCaddy(registryPath: string, options: EnsureCaddyOptions = {}): Promise<EnsureCaddyResult> {
	const runtime: EnsureCaddyRuntime = {
		fetch,
		probeRoute: probeHttpsRoute,
		sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
		reload: reloadCaddy,
		start: startCaddy,
		restart: restartCaddy,
		status: caddyStatus,
		...options.runtime,
	}
	const status = await runtime.status(registryPath, { repairStaleState: !options.dryRun })
	const plannedAction: 'start' | 'reload' = status.running ? 'reload' : 'start'
	if (options.dryRun) return { ...status, plannedAction }
	const routes = expectedRoutes(await readRegistry(registryPath))
	if (!status.running) {
		const next = await runtime.start(registryPath)
		await verifyCaddy(routes, runtime, options.verification)
		return { ...next, plannedAction }
	}
	try {
		await runtime.reload(registryPath)
	} catch {
		// A reload can report failure after Caddy has accepted the config; verification is authoritative.
	}
	try {
		await verifyCaddy(routes, runtime, options.verification)
		return { ...(await runtime.status(registryPath)), plannedAction }
	} catch (firstFailure) {
		await runtime.restart(registryPath)
		try {
			await verifyCaddy(routes, runtime, options.verification)
		} catch (restartFailure) {
			throw new Error(`Caddy restart did not converge: ${(restartFailure as Error).message}`, {
				cause: firstFailure,
			})
		}
		return { ...(await runtime.status(registryPath)), plannedAction }
	}
}

// A pi runtime built as pi's CLI builds one (main.js): one factory makes the services and the
// session at startup, and again for each /new, /resume and /fork. The harness's single session
// cannot switch sessions, show a UI or run pi's own print mode; this can. The model is a faux
// provider, sessions live in memory, and the only extension is the one passed in.

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FauxProviderHandle, fauxProvider, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import {
	type AgentSession,
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	type ExtensionUIContext,
	type InlineExtension,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from '@earendil-works/pi-coding-agent'

export async function createTestRuntime(
	extension: InlineExtension,
	cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-runtime-'))),
): Promise<{ runtime: AgentSessionRuntime; faux: FauxProviderHandle }> {
	const faux = fauxProvider()
	const credentials = new InMemoryCredentialStore()
	await credentials.modify(faux.provider.id, async () => ({ type: 'api_key', key: 'faux' }))
	const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null })
	modelRuntime.registerNativeProvider(faux.provider)
	const runtime = await createAgentSessionRuntime(
		async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				cwd,
				agentDir,
				modelRuntime,
				settingsManager: SettingsManager.inMemory(),
				resourceLoaderOptions: {
					noExtensions: true,
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
					noContextFiles: true,
					extensionFactories: [extension],
				},
			})
			const created = await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent,
				model: faux.getModel(),
			})
			return { ...created, services, diagnostics: services.diagnostics }
		},
		{ cwd, agentDir: join(cwd, 'agent'), sessionManager: SessionManager.inMemory(cwd) },
	)
	return { runtime, faux }
}

/** What the extension showed in one session's UI. */
export interface ShownUI {
	/** Each notify as "<type>: <message>", e.g. "info: HumanLayer: ready". */
	notes: string[]
	statuses: string[]
	widgets: (string[] | undefined)[]
	/** The options of each select. */
	selects: string[][]
}

/**
 * Binds session as interactive mode does, with a UI that records what the extension shows, so
 * session_start runs with hasUI true. A select answers with pick(options).
 */
export async function bindWithUI(
	session: AgentSession,
	pick: (options: string[]) => string | undefined = () => undefined,
): Promise<ShownUI> {
	const shown: ShownUI = { notes: [], statuses: [], widgets: [], selects: [] }
	const ui: ExtensionUIContext = {
		...session.extensionRunner.getUIContext(), // pi's no-op UI, before this bind
		notify: (message, type = 'info') => void shown.notes.push(`${type}: ${message}`),
		setStatus: (_key, text) => void shown.statuses.push(text ?? ''),
		setWidget: (_key: string, content: unknown) =>
			void shown.widgets.push(Array.isArray(content) ? content : undefined),
		select: async (_title, options) => {
			shown.selects.push(options)
			return pick(options)
		},
	}
	await session.bindExtensions({ uiContext: ui, mode: 'tui' })
	return shown
}

/** Runs /humanlayer with args through pi's command lookup, as typed in session. */
export async function humanlayerCommand(session: AgentSession, args: string): Promise<void> {
	const command = session.extensionRunner.getCommand('humanlayer')
	if (!command) throw new Error('no /humanlayer command')
	await command.handler(args, session.extensionRunner.createCommandContext())
}

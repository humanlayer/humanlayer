import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

import { DEFAULT_MODELS } from '@humanlayer/codelayer'
import { getAutomationResultExitCode } from '@humanlayer/riptide-daemon/src/lib/shutdown-exit-code'

import type { EnvironmentConfig, EnvironmentName } from '../lib/macros'
import { createApiORPCClient, createUnauthenticatedApiORPCClient } from '../orpc/client'
import {
	parseAutomationInactivityMilliseconds,
	parseAutomationPromptText,
	parseAutomationRunOptions,
	type AutomationRunOptions,
} from './AutomationRun'

export type { AutomationRunCliOptions, AutomationRunOptions } from './AutomationRun'

export function buildAutomationPrepareInput(
	options: AutomationRunOptions,
	input: { readonly hostId: string; readonly prompt: string; readonly workingDirectory: string },
) {
	const targetSession = {
		hostId: input.hostId,
		sessionName: options.sessionName,
		prompt: input.prompt,
		workingDirectory: input.workingDirectory,
		codingAgent: options.codingAgent,
		provider: options.provider,
		model: options.model ?? DEFAULT_MODELS[options.provider],
		effort: options.thinking,
		permissionsMode: 'bypass' as const,
	}
	return options.ensureTask !== undefined
		? {
				taskMode: 'ensure' as const,
				slug: options.ensureTask,
				task: {
					name: options.taskName,
					workflowType: 'freeform' as const,
					worktreeTiming: 'never' as const,
				},
				...targetSession,
			}
		: {
				taskMode: 'use' as const,
				taskIdOrSlug: options.useTask,
				...targetSession,
			}
}

export async function loadAutomationPrompt(options: AutomationRunOptions, workingDirectory: string): Promise<string> {
	if (options.prompt !== undefined) return options.prompt
	const promptPath = isAbsolute(options.promptFile)
		? options.promptFile
		: resolve(workingDirectory, options.promptFile)
	return parseAutomationPromptText(await readFile(promptPath, 'utf8'))
}

export async function writeAutomationMetadata(
	metadataFile: string,
	workingDirectory: string,
	metadata: { readonly taskId: string; readonly sessionId: string },
): Promise<void> {
	const metadataPath = isAbsolute(metadataFile) ? metadataFile : resolve(workingDirectory, metadataFile)
	await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
}

export async function automationRunCommand(
	envName: EnvironmentName,
	envConfig: EnvironmentConfig,
	input: unknown,
): Promise<number> {
	const options = parseAutomationRunOptions(input)

	const workingDirectory = process.cwd()
	const prompt = await loadAutomationPrompt(options, workingDirectory)

	const hostId = crypto.randomUUID()
	const client = createApiORPCClient(envConfig.apiOrigin, options.pat)
	const prepared = await client.automation.run.prepare(
		buildAutomationPrepareInput(options, { hostId, prompt, workingDirectory }),
	)
	if (options.metadataFile !== undefined) {
		await writeAutomationMetadata(options.metadataFile, workingDirectory, {
			taskId: prepared.taskId,
			sessionId: prepared.sessionId,
		})
	}
	const { token: launchToken } = await client.auth.daemon.launchToken.create({})
	const { token: daemonToken } = await createUnauthenticatedApiORPCClient(
		envConfig.apiOrigin,
	).auth.daemon.token.exchange({
		launchToken,
		hostId,
	})

	if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'info'
	process.env.RIPTIDE_CLOUD_ORIGIN = envConfig.cloudOrigin
	process.env.RIPTIDE_APP_ORIGIN = envConfig.appOrigin
	const { startManagedDaemon } = await import('@humanlayer/riptide-daemon/start')
	const result = await startManagedDaemon({
		token: daemonToken,
		apiOrigin: envConfig.apiOrigin,
		syncOrigin: envConfig.syncOrigin,
		stage: envName,
		generationId: null,
		expectedIdentity: { userId: prepared.userId, hostId: prepared.hostId },
		selfUpdate: null,
		automation: {
			targetSessionId: prepared.sessionId,
			lifecycle: {
				shutdownOn: options.shutdownOn,
				inactivityMs: options.inactivity,
				onFailure: options.onFailure,
			},
		},
	})
	if (result.type === 'daemon_already_running') throw new Error(result.message)
	if (result.type === 'daemon_ready') throw new Error('Automation daemon exited without a bounded result')

	return getAutomationResultExitCode(result)
}

export const parseAutomationInactivityMs = parseAutomationInactivityMilliseconds

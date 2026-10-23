import type { LauncherV3Command } from './launcher-v3-form'

export const LAUNCHER_V3_TASK_ID = '019fcc4b-88cd-742f-970e-cd072c8b79f0'
export const LAUNCHER_V3_SESSION_ID = '019fcc4b-88cd-742f-970e-cd072c8b79f1'
export const LAUNCHER_V3_EVENT_ID = '019fcc4b-88cd-742f-970e-cd072c8b79f2'
export const LAUNCHER_V3_PROJECT_ID = '019fcc4b-88cd-742f-970e-cd072c8b79f3'

export function launcherV3Command(overrides: Partial<LauncherV3Command> = {}): LauncherV3Command {
	return {
		promptText: 'Build the plain launcher',
		ticket: null,
		title: 'Launcher V3',
		slug: 'launcher-v3',
		hostId: 'host-1',
		directory: '/repo/syncopate',
		workflowType: 'freeform',
		autoAdvance: false,
		worktreeTiming: 'never',
		autoAdvanceFlags: {
			autoAdvanceQuestionsToResearch: false,
			autoAdvanceResearchToDesign: false,
			autoAdvancePlanToWorktree: false,
			autoAdvanceWorktreeToImplementation: false,
			autoAdvanceImplementationToPr: false,
		},
		permissionsMode: 'auto',
		agent: 'claude',
		provider: 'anthropic',
		model: 'opus',
		effort: 'high',
		fastMode: false,
		attachments: [],
		...overrides,
	}
}

export function launcherV3ProjectLaunch(): NonNullable<LauncherV3Command['project']> {
	return {
		projectId: LAUNCHER_V3_PROJECT_ID,
		defaultRepositoryIdentity: 'github.com/humanlayer/syncopate',
		repositories: [
			{
				remoteUrl: 'git@github.com:humanlayer/syncopate.git',
				repositoryIdentity: 'github.com/humanlayer/syncopate',
				defaultBranch: 'main',
				branch: 'launcher-v3',
				default: true,
				autoPushBranch: false,
				copyGlobs: [],
			},
		],
	}
}

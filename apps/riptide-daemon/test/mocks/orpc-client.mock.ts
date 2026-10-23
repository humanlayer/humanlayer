import type { ORPCClient } from '../../src/agents/claudecode/types'

function notImplemented(name: string) {
	return async (..._args: unknown[]) => {
		throw new Error(`Mock not implemented: ${name}`)
	}
}

type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

function deepMerge<T extends Record<string, unknown>>(base: T, overrides: DeepPartial<T>): T {
	const result = { ...base }
	for (const key of Object.keys(overrides) as (keyof T)[]) {
		const val = overrides[key]
		if (val && typeof val === 'object' && !Array.isArray(val) && typeof base[key] === 'object') {
			result[key] = deepMerge(
				base[key] as Record<string, unknown>,
				val as DeepPartial<Record<string, unknown>>,
			) as T[keyof T]
		} else if (val !== undefined) {
			result[key] = val as T[keyof T]
		}
	}
	return result
}

export function createMockORPCClient(overrides?: DeepPartial<ORPCClient>): ORPCClient {
	const base = {
		hosts: {
			heartbeat: notImplemented('hosts.heartbeat'),
			shutdown: notImplemented('hosts.shutdown'),
		},
		comments: {
			get: notImplemented('comments.get'),
			update: notImplemented('comments.update'),
			reply: notImplemented('comments.reply'),
		},
		diffComments: {
			get: notImplemented('diffComments.get'),
			update: notImplemented('diffComments.update'),
			reply: notImplemented('diffComments.reply'),
		},
		sessions: {
			update: notImplemented('sessions.update'),
			ensureStreamHydrated: notImplemented('sessions.ensureStreamHydrated'),
			events: {
				create: notImplemented('sessions.events.create'),
			},
			commits: {
				record: notImplemented('sessions.commits.record'),
			},
			usage: {
				record: notImplemented('sessions.usage.record'),
			},
			pullRequests: {
				upsert: notImplemented('sessions.pullRequests.upsert'),
			},
			repositories: {
				report: notImplemented('sessions.repositories.report'),
			},
		},
		commits: {
			recordObserved: notImplemented('commits.recordObserved'),
			watermark: {
				get: notImplemented('commits.watermark.get'),
				set: notImplemented('commits.watermark.set'),
			},
		},
		pullRequests: {
			listOpenForHost: notImplemented('pullRequests.listOpenForHost'),
			refreshStatus: notImplemented('pullRequests.refreshStatus'),
		},
		projectWorkspaces: {
			getRepositoryStatus: notImplemented('projectWorkspaces.getRepositoryStatus'),
			getSessionWorkspaceSetup: notImplemented('projectWorkspaces.getSessionWorkspaceSetup'),
			getTaskWorkspaceContext: notImplemented('projectWorkspaces.getTaskWorkspaceContext'),
			reportRepositoryResult: notImplemented('projectWorkspaces.reportRepositoryResult'),
		},
		users: {
			setGithubIdentity: notImplemented('users.setGithubIdentity'),
		},
		approvals: {
			create: notImplemented('approvals.create'),
		},
		agents: {
			research: notImplemented('agents.research'),
		},
		agentCommands: {
			report: notImplemented('agentCommands.report'),
		},
		codelayerState: {
			get: notImplemented('codelayerState.get'),
			snapshot: {
				get: notImplemented('codelayerState.snapshot.get'),
			},
			upsert: notImplemented('codelayerState.upsert'),
		},
		foldSessionEvents: {
			append: notImplemented('foldSessionEvents.append'),
			list: notImplemented('foldSessionEvents.list'),
		},
		artifacts: {
			upsert: notImplemented('artifacts.upsert'),
			downloadUrl: notImplemented('artifacts.downloadUrl'),
			createUpload: notImplemented('artifacts.createUpload'),
		},
		settings: {
			get: notImplemented('settings.get'),
		},
		contextShards: {
			listEnabled: notImplemented('contextShards.listEnabled'),
		},
		workspaceSetup: {
			update: notImplemented('workspaceSetup.update'),
		},
		providerLogin: {
			update: notImplemented('providerLogin.update'),
		},
		sync: {
			sessions: notImplemented('sync.sessions'),
			approvals: notImplemented('sync.approvals'),
			tasks: notImplemented('sync.tasks'),
			artifacts: notImplemented('sync.artifacts'),
			taskWorkspaceSetupForHost: notImplemented('sync.taskWorkspaceSetupForHost'),
		},
		integrations: {
			github: {
				syncArtifactBacklink: notImplemented('integrations.github.syncArtifactBacklink'),
			},
			jira: {
				createRemoteLink: notImplemented('integrations.jira.createRemoteLink'),
			},
			linear: {
				updateIssueStatus: notImplemented('integrations.linear.updateIssueStatus'),
				createAttachment: notImplemented('integrations.linear.createAttachment'),
			},
		},
	} satisfies ORPCClient

	return overrides ? deepMerge(base, overrides) : base
}

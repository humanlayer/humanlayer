import type { PermissionsMode } from '@humanlayer/db/tables/sessions'
import type { TicketProvider } from '@humanlayer/db/tables/tasks'
import type { Task } from '@humanlayer/db/tables/tasks'
import type { CreatedWithExperimentFlags } from '@humanlayer/db/zodschemas/created-with-experiment-flags'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import type { WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'
import type { TaskIntent } from '@humanlayer/schemas/task-intent'

import type { PreparedTicketArtifactBundle } from '../../../lib/linear-ticket-artifacts'

export type TaskLaunchAttachment = {
	readonly fileName: string
	readonly contentType: string
	readonly fileSizeBytes: number
	readonly contentHash: string
}

export type TaskLaunchFirstSession = {
	readonly id: string
	readonly eventId: string
	readonly title: string | null
	readonly text: string
	readonly workingDirectory: string
	readonly hostId: string
	readonly codingAgent: CodingAgent
	readonly provider: string
	readonly model: string
	readonly effort?: string | null
	readonly fastMode?: boolean | null
	readonly permissionsMode: PermissionsMode
	/** Set by the launcher when it knows; otherwise freeform launches are classified. */
	readonly intent?: Exclude<TaskIntent, 'unknown'>
}

export type LaunchTaskDraftInput = {
	readonly draftId: string
	readonly organizationId: string
	readonly userId: string
	readonly name: string
	readonly slug: string
	readonly defaultWorkingDirectory: string
	readonly taskContent: string
	readonly workspaceSpec?: WorkspaceSpec
	readonly ticketId?: string
	readonly ticketUrl?: string
	readonly ticketDescription?: string
	readonly ticketProvider?: TicketProvider
	readonly githubConnectionId?: string
	readonly ticketRepositoryId?: string
	readonly ticketRepositoryFullName?: string
	readonly workflowType: 'outline_only' | 'prd_tdd' | 'oneshot' | 'freeform'
	readonly worktreeTiming: 'now' | 'later' | 'never'
	readonly autoAdvanceQuestionsToResearch: boolean
	readonly autoAdvanceResearchToDesign: boolean
	readonly autoAdvancePlanToWorktree: boolean
	readonly autoAdvanceWorktreeToImplementation: boolean
	readonly autoAdvanceImplementationToPr: boolean
	readonly createdWithExperimentFlags?: CreatedWithExperimentFlags
	readonly attachments: readonly TaskLaunchAttachment[]
	readonly importedTicket?: PreparedTicketArtifactBundle
	readonly firstSession: TaskLaunchFirstSession
	readonly intent?: TaskIntent
}

export type TaskLaunchOutcome = 'created' | 'promoted' | 'already-launched'

export type LaunchTaskDraftResult = {
	readonly outcome: TaskLaunchOutcome
	readonly taskId: string
	readonly firstSessionId: string
	readonly transactionId: string
	readonly task: Task
}

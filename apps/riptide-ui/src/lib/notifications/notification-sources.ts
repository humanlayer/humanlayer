type Millis = bigint | number | string

export interface NotificationSession {
	id: string
	task_id: string | null
	created_by: string
	resource_owner_user_id: string
	title: string | null
	summary: string | null
	status: string
	error_message: string | null
	archived: boolean
	updated_at: Millis
	multiplayer_prompting_user_ids?: string[] | null
	multiplayer_prompting_started_at?: bigint | null
	multiplayer_prompting_expires_at?: bigint | null
}

export interface NotificationApproval {
	id: string
	session_id: string
	status: string
	tool_name: string | null
	tool_input: unknown
	created_at: Millis
}

export interface NotificationTask {
	id: string
	name: string
	resource_owner_user_id: string
}

export interface NotificationArtifact {
	id: string
	file_name: string | null
}

export interface NotificationArtifactComment {
	id: string
	artifact_id: string
	task_id: string
	resource_owner_user_id: string
	created_by_user_id: string | null
	anonymous_guest_name: string | null
	reply_to_comment_id: string | null
	content_text: string
	is_resolved: boolean
	is_deleted: boolean
	created_at: Millis
}

export interface NotificationDiffComment {
	id: string
	task_id: string
	resource_owner_user_id: string
	created_by_user_id: string
	reply_to_comment_id: string | null
	content_text: string
	anchor_json: { path?: string | null } | null
	is_resolved: boolean
	is_deleted: boolean
	created_at: Millis
}

export interface NotificationWorkspaceSetup {
	id: string
	task_id: string
	error: { message: string } | null
	updated_at: Millis
}

export interface NotificationSources {
	userId: string
	now: number
	seen: Readonly<Record<string, number>>
	multiplayerPromptingEnabled: boolean
	unreadSessionIds: ReadonlySet<string>
	sessions: readonly NotificationSession[]
	approvals: readonly NotificationApproval[]
	tasks: readonly NotificationTask[]
	artifacts: readonly NotificationArtifact[]
	artifactComments: readonly NotificationArtifactComment[]
	diffComments: readonly NotificationDiffComment[]
	workspaceSetups: readonly NotificationWorkspaceSetup[]
}

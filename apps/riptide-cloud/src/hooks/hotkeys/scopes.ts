export const HOTKEY_SCOPES = {
	GLOBAL: '*',
	ROOT: '.',
	// Page-specific scopes
	ARTIFACT_DETAIL: 'artifacts.detail',
	ARTIFACTS_LIST: 'artifacts.list',
	TASKS_LIST: 'tasks.list',
	TASK_ARTIFACTS_LIST: 'tasks.artifacts.list',
	// Component-specific scopes
	ARTIFACT_FULLSCREEN: 'artifact.fullscreen',
	/**
	 * Active only while an Artifact Viewer V2 block/range target is live, so the
	 * instant `a`/`d` verdicts own those keys during review. Mirrors riptide-ui;
	 * Cloud has no session approval shortcuts to collide with, but the scope is
	 * kept for parity with the shared target/hotkey adapters.
	 */
	ARTIFACT_V2_REVIEW: 'artifact.v2Review',
	ARTIFACT_COMMENT_DELETE_DIALOG: 'artifact.commentDeleteDialog',
} as const

export type HotkeyScope = (typeof HOTKEY_SCOPES)[keyof typeof HOTKEY_SCOPES]

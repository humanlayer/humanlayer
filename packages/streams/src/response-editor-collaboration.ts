export const RESPONSE_EDITOR_SCHEMA_VERSION = 1
export const RESPONSE_EDITOR_DOCUMENT_ID = 'response-v1'
export const RESPONSE_EDITOR_STREAM_TTL_SECONDS = 3600
export const RESPONSE_EDITOR_COLLABORATION_ROUTE =
	'/v2/collaboration/organizations/:organizationId/sessions/:sessionId/response/docs/response-v1'

export interface ResponseEditorKey {
	organizationId: string
	sessionId: string
}

export const responseEditorCollaborationBasePath = (key: ResponseEditorKey): string =>
	`/v2/collaboration/organizations/${encodeURIComponent(key.organizationId)}/sessions/${encodeURIComponent(key.sessionId)}/response`

export const responseEditorCollaborationPath = (key: ResponseEditorKey): string =>
	`${responseEditorCollaborationBasePath(key)}/docs/${RESPONSE_EDITOR_DOCUMENT_ID}`

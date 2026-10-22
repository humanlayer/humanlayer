import { describe, expect, it } from 'vitest'

import {
	RESPONSE_EDITOR_COLLABORATION_ROUTE,
	RESPONSE_EDITOR_DOCUMENT_ID,
	RESPONSE_EDITOR_SCHEMA_VERSION,
	RESPONSE_EDITOR_STREAM_TTL_SECONDS,
	responseEditorCollaborationBasePath,
	responseEditorCollaborationPath,
} from '../response-editor-collaboration'

describe('response collaboration paths', () => {
	it('encodes identity components without mixing them into the document ID', () => {
		const key = { organizationId: 'org/a', sessionId: 'session?b' }
		expect(responseEditorCollaborationBasePath(key)).toBe(
			'/v2/collaboration/organizations/org%2Fa/sessions/session%3Fb/response',
		)
		expect(responseEditorCollaborationPath(key)).toBe(
			`${responseEditorCollaborationBasePath(key)}/docs/response-v1`,
		)
		expect(RESPONSE_EDITOR_DOCUMENT_ID).toBe('response-v1')
		expect(RESPONSE_EDITOR_SCHEMA_VERSION).toBe(1)
		expect(RESPONSE_EDITOR_STREAM_TTL_SECONDS).toBe(3600)
		expect(RESPONSE_EDITOR_COLLABORATION_ROUTE).toContain('/organizations/:organizationId/sessions/:sessionId/')
	})
})

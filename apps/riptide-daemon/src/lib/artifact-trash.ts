export { ARTIFACT_TRASH_DIRECTORY, isReservedArtifactTrashSubpath } from '@humanlayer/session-sdk-artifacts'

export const ARTIFACT_TRASH_SKIP_CONTEXT =
	'This artifact is in the trash so it is not synced, and you may want to disregard it. If it is highly relevant, you can ask the user to take it out of the trash using the artifact sidebar.'

export function formatArtifactTrashSkipMessage(originalOutput: string): string {
	return `${originalOutput}\n\n<system-reminder>\n${ARTIFACT_TRASH_SKIP_CONTEXT}\n</system-reminder>`
}

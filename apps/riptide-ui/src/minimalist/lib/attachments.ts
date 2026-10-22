import type { RiptideApiInputs } from '@humanlayer/riptide-api-contract/contract-router'

export type AttachmentMetadata = NonNullable<RiptideApiInputs['tasks']['launchDraft']['attachments']>[number]
export const MAX_FILE_SIZE = 50 * 1024 * 1024

export function attachmentPath(name: string, id: string): string {
	return `uploads/${id}-${name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-180) || 'file'}`
}

export function withAttachments(text: string, slug: string, files: AttachmentMetadata[]): string {
	return [text.trim(), ...files.map((file) => `@.humanlayer/tasks/${slug}/${file.fileName}`)]
		.filter(Boolean)
		.join('\n\n')
}

const UPLOAD_MENTION = /@\.humanlayer\/tasks\/[^/\s]+\/(uploads\/\S+)/g

/**
 * A sent message's words and the files attached to it. Uploads ride along as
 * @-mentions of their task path; mentions of task documents stay in the text.
 */
export function splitAttachments(message: string): { text: string; files: string[] } {
	const files = [...message.matchAll(UPLOAD_MENTION)].flatMap((match) => match[1] ?? [])
	const text = message
		.replace(UPLOAD_MENTION, '')
		.replace(/ {2,}/g, ' ')
		.replace(/[ \t]+$/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
	return { text, files }
}

export function isImage(fileName: string): boolean {
	return /\.(png|jpe?g|gif|webp)$/i.test(fileName)
}

export async function fileMetadata(file: File, fileName: string): Promise<AttachmentMetadata> {
	const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
	return {
		fileName,
		contentType: file.type || 'application/octet-stream',
		fileSizeBytes: file.size,
		contentHash: Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(''),
	}
}

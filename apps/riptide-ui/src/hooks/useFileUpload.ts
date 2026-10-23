import type { Editor } from '@tiptap/core'
import type { RefObject } from 'react'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useTaskArtifacts } from '@/hooks/live-queries/useTaskArtifacts'
import { getResponseEditorContentPort, insertIntoCurrentResponseEditor } from '@/hooks/use-response-editor-content-port'
import { createUniqueUploadFileNames } from '@/lib/unique-upload-file-names'
import { useRiptideApi } from '@/orpc/client'

const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB
const TEXT_EXTENSIONS = /\.(md|mdx|txt)$/i

async function computeSha256(file: File): Promise<string> {
	const buffer = await file.arrayBuffer()
	const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
	const hashArray = Array.from(new Uint8Array(hashBuffer))
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface UseFileUploadOptions {
	taskId: string
	taskSlug: string
	/**
	 * TipTap editor ref for the desktop composer. When provided, the uploaded
	 * file's mention is inserted inline into the editor. Optional so surfaces
	 * without a TipTap editor (e.g. the mobile composer, which uses a plain
	 * textarea) can reuse the exact same upload path.
	 */
	editorRef?: RefObject<{ editor: Editor | null } | null>
	/**
	 * Called after a successful upload with the file-mention id and the file.
	 * Used by surfaces without a TipTap editor to track the attachment (e.g. the
	 * mobile composer renders it as a removable chip and appends the mention id
	 * to the outgoing message text). The mention id format is identical to what
	 * the editor inserts, so the daemon receives the same reference either way.
	 */
	onUploaded?: (params: { mentionId: string; file: File }) => void
}

export interface CompletedAttachment {
	mentionId: string
	fileName: string
}

/** The upload may outlive its component. Completion returns a candidate when
 * its insertion lease has expired; explicit insertion resolves a new target. */
export function captureAttachmentInsertion(editorRef: UseFileUploadOptions['editorRef']) {
	const editor = editorRef?.current?.editor
	const insertIfCurrent = getResponseEditorContentPort(editor)?.captureInsertion()
	return (candidate: CompletedAttachment) => {
		const content = attachmentContent(candidate)
		if (insertIfCurrent) return insertIfCurrent(content)
		if (!editor || editorRef?.current?.editor !== editor || editor.isDestroyed || !editor.isEditable) return false
		return editor.chain().focus().insertContent(content).run()
	}
}

function attachmentContent(candidate: CompletedAttachment) {
	return [
		{
			type: 'file-mention',
			attrs: { id: candidate.mentionId, label: candidate.fileName, isDirectory: false, isArtifact: true },
		},
		{ type: 'text', text: ' ' },
	]
}

export function insertCompletedAttachment(candidate: CompletedAttachment) {
	return insertIntoCurrentResponseEditor(attachmentContent(candidate))
}

export function useFileUpload({ taskId, taskSlug, editorRef, onUploaded }: UseFileUploadOptions) {
	const { client } = useRiptideApi()
	const taskArtifacts = useTaskArtifacts(taskId)
	const [pendingUploadCount, setPendingUploadCount] = useState(0)
	const reservedFileNamesByTaskRef = useRef(new Map<string, Set<string>>())

	const uploadFile = useCallback(
		async (file: File, fileName: string) => {
			const editor = editorRef?.current?.editor ?? null
			const insertIfCurrent = captureAttachmentInsertion(editorRef)
			if (!taskId || !taskSlug) return
			// Editor-based callers (desktop) must wait for the editor to be ready
			// before we can insert the mention. Callers without an editorRef
			// (mobile) skip this gate and rely on onUploaded instead.
			if (editorRef && !editor) return
			const uploadedFile =
				fileName === file.name
					? file
					: new File([file], fileName, { type: file.type, lastModified: file.lastModified })

			// Size validation
			if (uploadedFile.size > MAX_UPLOAD_SIZE_BYTES) {
				toast.error(
					`File too large: ${(uploadedFile.size / 1024 / 1024).toFixed(1)} MB exceeds ${MAX_UPLOAD_SIZE_BYTES / 1024 / 1024} MB limit`,
				)
				return
			}

			setPendingUploadCount((c) => c + 1)

			try {
				if (TEXT_EXTENSIONS.test(uploadedFile.name)) {
					// Route text files through the postgres artifact pipeline instead of S3
					const text = await uploadedFile.text()
					await client.uploads.upsertText({
						taskId,
						fileName: uploadedFile.name,
						content: text,
					})
				} else {
					const contentHash = await computeSha256(uploadedFile)

					// Step 1: Get presigned URL (no DB write)
					const { uploadUrl } = await client.uploads.getPresignedUrl({
						taskId,
						fileName: uploadedFile.name,
						contentType: uploadedFile.type || 'application/octet-stream',
					})

					// Step 2: Upload directly to S3
					const response = await fetch(uploadUrl, {
						method: 'PUT',
						body: uploadedFile,
						headers: {
							'Content-Type': uploadedFile.type || 'application/octet-stream',
						},
					})

					if (!response.ok) {
						throw new Error(`S3 upload failed: ${response.status} ${response.statusText}`)
					}

					// Step 3: Create artifact row (S3 object already exists)
					await client.uploads.create({
						taskId,
						fileName: uploadedFile.name,
						contentType: uploadedFile.type || 'application/octet-stream',
						contentHash,
						fileSizeBytes: uploadedFile.size,
					})
				}

				const mentionId = `@.humanlayer/tasks/${taskSlug}/${uploadedFile.name}`

				// Insert file-mention badge into editor (desktop composer)
				if (editor) {
					const candidate = { mentionId, fileName: uploadedFile.name }
					const inserted = insertIfCurrent(candidate)
					if (!inserted) {
						toast.success(`Uploaded ${uploadedFile.name} — ready to insert`, {
							duration: Infinity,
							action: {
								label: 'Insert attachment',
								onClick: (event) => {
									if (!insertCompletedAttachment(candidate)) {
										event.preventDefault()
										toast.error('Open an editable response before inserting this attachment')
									}
								},
							},
						})
						return
					}
				}

				// Notify editor-less callers (mobile composer) so they can track
				// the attachment and append the mention id to the outgoing message.
				onUploaded?.({ mentionId, file: uploadedFile })

				toast.success(`Uploaded ${uploadedFile.name}`)
			} catch (error) {
				toast.error(`Failed to upload ${uploadedFile.name}`)
				console.error('File upload error:', error)
			} finally {
				setPendingUploadCount((c) => c - 1)
			}
		},
		[client, editorRef, taskId, taskSlug, onUploaded],
	)

	const uploadFiles = useCallback(
		(files: File[]) => {
			const reservedFileNames = reservedFileNamesByTaskRef.current.get(taskId) ?? new Set<string>()
			reservedFileNamesByTaskRef.current.set(taskId, reservedFileNames)
			const unavailableFileNames = [...taskArtifacts.map((artifact) => artifact.file_name), ...reservedFileNames]
			const uniqueFileNames = createUniqueUploadFileNames(
				files.map((file) => file.name),
				unavailableFileNames,
			)

			for (const [index, file] of files.entries()) {
				const fileName = uniqueFileNames[index]
				if (fileName === undefined) continue
				reservedFileNames.add(fileName)
				void uploadFile(file, fileName)
			}
		},
		[taskArtifacts, taskId, uploadFile],
	)

	const isAtLeastOneArtifactUploading = pendingUploadCount > 0

	return { uploadFiles, pendingUploadCount, isAtLeastOneArtifactUploading }
}

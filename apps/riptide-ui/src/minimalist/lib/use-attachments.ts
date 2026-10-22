import { useRef, useState } from 'react'
import { uuidv7 } from 'uuidv7'

import { useMountEffect } from '@/hooks/useMountEffect'
import { type AttachmentMetadata, attachmentPath, fileMetadata, MAX_FILE_SIZE } from '@/minimalist/lib/attachments'
import { useUi } from '@/minimalist/lib/ui-state'
import { useRiptideApi } from '@/orpc/client'

export type Attachment = {
	id: string
	file: File
	status: 'uploading' | 'ready' | 'failed'
	metadata?: AttachmentMetadata
	/** A local object URL for images, so the chip shows the picture before it uploads. */
	preview?: string
}

export function useAttachments(taskId: string | null, existing: boolean) {
	const { client: api } = useRiptideApi()
	const { showToast } = useUi()
	const [files, setFiles] = useState<Attachment[]>([])
	const requests = useRef(new Map<string, AbortController>())
	const previews = useRef(new Map<string, string>())
	const release = (id: string) => {
		const url = previews.current.get(id)
		if (url) URL.revokeObjectURL(url)
		previews.current.delete(id)
	}
	useMountEffect(() => () => {
		for (const request of requests.current.values()) request.abort()
		for (const url of previews.current.values()) URL.revokeObjectURL(url)
	})
	const upload = async (entry: Attachment) => {
		if (!taskId) return
		const controller = new AbortController()
		requests.current.set(entry.id, controller)
		setFiles((current) => current.map((file) => (file.id === entry.id ? { ...file, status: 'uploading' } : file)))
		try {
			const metadata = await fileMetadata(entry.file, attachmentPath(entry.file.name, entry.id))
			if (existing && /\.(md|mdx|txt)$/i.test(entry.file.name)) {
				await api.uploads.upsertText({ taskId, fileName: metadata.fileName, content: await entry.file.text() })
			} else {
				const { uploadUrl } = await api.uploads.v2.getPresignedUrl({
					taskId,
					fileName: metadata.fileName,
					contentType: metadata.contentType,
				})
				const response = await fetch(uploadUrl, {
					method: 'PUT',
					body: entry.file,
					headers: { 'Content-Type': metadata.contentType },
					signal: controller.signal,
				})
				if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
				if (existing) await api.uploads.create({ taskId, ...metadata })
			}
			if (!controller.signal.aborted)
				setFiles((current) =>
					current.map((file) => (file.id === entry.id ? { ...file, status: 'ready', metadata } : file)),
				)
		} catch {
			if (!controller.signal.aborted) {
				setFiles((current) =>
					current.map((file) => (file.id === entry.id ? { ...file, status: 'failed' } : file)),
				)
				showToast(`Could not upload ${entry.file.name}. Retry the upload or remove the file before sending.`)
			}
		} finally {
			requests.current.delete(entry.id)
		}
	}
	const add = (incoming: File[]) => {
		if (!taskId) return
		if (files.length + incoming.length > 50) {
			showToast('Attach up to 50 files at a time. Remove a file before adding more.')
			return
		}
		const entries = incoming
			.filter((file) => {
				if (file.size <= MAX_FILE_SIZE) return true
				showToast(`${file.name} exceeds 50 MB. Choose a smaller file.`)
				return false
			})
			.map((file): Attachment => {
				const id = uuidv7()
				if (!file.type.startsWith('image/')) return { id, file, status: 'uploading' }
				const preview = URL.createObjectURL(file)
				previews.current.set(id, preview)
				return { id, file, status: 'uploading', preview }
			})
		setFiles((current) => [...current, ...entries])
		for (const entry of entries) void upload(entry)
	}
	return {
		files,
		add,
		retry: (entry: Attachment) => {
			if (!requests.current.has(entry.id)) void upload(entry)
		},
		remove: (id: string) => {
			requests.current.get(id)?.abort()
			release(id)
			setFiles((current) => current.filter((file) => file.id !== id))
		},
		clear: () => {
			for (const id of [...previews.current.keys()]) release(id)
			setFiles([])
		},
		blocked: files.some((file) => file.status !== 'ready'),
		metadata: files.flatMap((file) => (file.status === 'ready' && file.metadata ? [file.metadata] : [])),
	}
}

export type ComposerAttachments = ReturnType<typeof useAttachments>

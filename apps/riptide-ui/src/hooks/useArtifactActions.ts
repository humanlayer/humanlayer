import { useCopyToClipboard } from '@uidotdev/usehooks'
import { useCallback } from 'react'
import { toast } from 'sonner'

import { openFileInEditor } from '@/lib/file-opener'
import { openCloudUrl } from '@/lib/url-opener'
import { isTauri } from '@/lib/utils'
import { extractArtifactPath } from '@/utils/artifact-categorization'
import { getArtifactCloudUrl } from '@/utils/artifact-links'

import { useLocalTaskArtifactDirectory } from './useLocalTaskArtifactDirectory'

function joinPath(basePath: string, relativePath: string): string {
	return `${basePath.replace(/\/+$/, '')}/${relativePath.replace(/^\/+/, '')}`
}

export interface UseArtifactActionsProps {
	/** Artifact ID from database - required for cloud actions */
	artifactId?: string | null
	/** Task ID used to find a path on the current user's local host */
	taskId: string
	/** File path relative to working directory */
	filePath?: string
	/** Whether the session is colocated with the local Tauri app */
	isColocated?: boolean
}

export function useArtifactActions({ artifactId, taskId, filePath, isColocated }: UseArtifactActionsProps) {
	const [, copyToClipboard] = useCopyToClipboard()
	const workingDirectory = useLocalTaskArtifactDirectory(taskId)
	const localFilePath = filePath ? (extractArtifactPath(filePath) ?? filePath) : undefined

	const handleOpenInCloud = useCallback(() => {
		if (!artifactId) return
		openCloudUrl(getArtifactCloudUrl(artifactId))
	}, [artifactId])

	const handleCopyCloudLink = useCallback(() => {
		if (!artifactId) return
		const url = getArtifactCloudUrl(artifactId)
		if (!url) {
			toast.error('Could not copy cloud link', {
				description: 'This build has no cloud address. Set VITE_PUBLIC_CLOUD_ORIGIN and rebuild.',
			})
			return
		}
		void copyToClipboard(url)
		toast.success('Cloud link copied to clipboard', { duration: 3000, closeButton: true })
	}, [artifactId, copyToClipboard])

	const handleOpenInEditor = useCallback(() => {
		if (!localFilePath || !workingDirectory) return
		if (isTauri() && !(isColocated ?? true)) {
			const fullPath = joinPath(workingDirectory, localFilePath)
			void copyToClipboard(fullPath)
			toast.success('Path copied to clipboard', { duration: 3000 })
			return
		}
		void openFileInEditor({
			filePath: localFilePath,
			workingDir: workingDirectory,
		})
	}, [localFilePath, workingDirectory, isColocated, copyToClipboard])

	const handleCopyPath = useCallback(() => {
		if (!localFilePath || !workingDirectory) return
		const fullPath = joinPath(workingDirectory, localFilePath)
		void copyToClipboard(fullPath)
		toast.success('Path copied to clipboard', { duration: 3000, closeButton: true })
	}, [localFilePath, workingDirectory, copyToClipboard])

	const handleCopyRelativePath = useCallback(() => {
		if (!localFilePath || !workingDirectory) return
		void copyToClipboard(localFilePath)
		toast.success('Relative path copied to clipboard', { duration: 3000, closeButton: true })
	}, [localFilePath, workingDirectory, copyToClipboard])

	return {
		handleOpenInCloud,
		handleCopyCloudLink,
		handleOpenInEditor,
		handleCopyPath,
		handleCopyRelativePath,
		hasCloudActions: !!artifactId,
		hasFileActions: !!localFilePath && !!workingDirectory,
	}
}

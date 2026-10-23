import type { SharedArtifactResolution } from '@humanlayer/riptide-api-contract/api/public/artifacts/resolve'
import { ArtifactViewer, type ArtifactViewMode } from '@humanlayer/ui/components/artifact-viewer'
import { Card } from '@humanlayer/ui/components/card'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { clampArtifactViewMode } from '@humanlayer/ui/lib/file-types'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { FileQuestion } from 'lucide-react'
import { hash } from 'ohash'
import { useState } from 'react'

import { ArtifactViewerV2, type ArtifactReview } from '@/components/artifact-viewer-v2/ArtifactViewerV2'
import { useSharedArtifactCollection } from '@/hooks/shared-artifact/useSharedArtifactCollection'
import { useShareLinkArtifactReview } from '@/hooks/shared-artifact/useShareLinkArtifactReview'
import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { useDeepLinkHandoff } from '@/hooks/useDeepLinkHandoff'
import { useMountEffect } from '@/hooks/useMountEffect'
import { authenticatedArtifactDestination } from '@/lib/auth-routing'
import { useRiptideApi } from '@/orpc/client'

import { GuestCommentIdentityDialog } from './GuestCommentIdentityDialog'
import { SharedArtifactShell } from './SharedArtifactShell'

type SharedArtifactRouteProps = { artifactId: string; shareKey?: string }

export function SharedArtifactRoute({ artifactId, shareKey }: SharedArtifactRouteProps) {
	const { isLoading: isAuthLoading, user } = useAuth()
	const { client } = useRiptideApi()
	const resolution = useQuery({
		queryKey: ['shared-artifact-resolution', artifactId, shareKey ? hash(shareKey) : null, user?.id ?? null],
		queryFn: () => client.public.artifacts.resolve({ artifactId, shareKey }),
		enabled: !isAuthLoading,
		retry: false,
	})

	if (isAuthLoading || resolution.isLoading) return <SharedArtifactLoading />
	if (resolution.isError || !resolution.data) return <SharedArtifactUnavailable />

	const handoffKey = user?.id ? `${user.id}:${resolution.data.kind}` : 'anonymous'
	return (
		<ResolvedSharedArtifact
			key={handoffKey}
			artifactId={artifactId}
			shareKey={shareKey}
			resolution={resolution.data}
			signedIn={!!user}
		/>
	)
}

type Resolution = SharedArtifactResolution

function ResolvedSharedArtifact({
	artifactId,
	shareKey,
	resolution,
	signedIn,
}: SharedArtifactRouteProps & { resolution: Resolution; signedIn: boolean }) {
	useDeepLinkHandoff(`nav/shared/artifacts/${artifactId}`, signedIn)

	if (resolution.kind === 'authenticated') return <AuthenticatedDestination resolution={resolution} />
	if (resolution.kind === 'switch_organization') return <OrganizationSwitchDestination resolution={resolution} />
	if (resolution.kind === 'public' && shareKey) {
		return (
			<SharedArtifactCollectionScope
				key={`${artifactId}:${hash(shareKey)}`}
				artifactId={artifactId}
				shareKey={shareKey}
				permission={resolution.permission}
			/>
		)
	}
	return <SharedArtifactUnavailable />
}

function AuthenticatedDestination({ resolution }: { resolution: Extract<Resolution, { kind: 'authenticated' }> }) {
	const navigate = useNavigate()
	useMountEffect(() => {
		void navigate(authenticatedArtifactDestination(resolution.taskId, resolution.artifactId))
	})
	return <SharedArtifactLoading />
}

function OrganizationSwitchDestination({
	resolution,
}: {
	resolution: Extract<Resolution, { kind: 'switch_organization' }>
}) {
	const { switchOrganization } = useBrowserAuth()
	const navigate = useNavigate()
	useMountEffect(() => {
		void switchOrganization({ organizationId: resolution.workosOrganizationId }).then(() =>
			navigate(authenticatedArtifactDestination(resolution.taskId, resolution.artifactId)),
		)
	})
	return <SharedArtifactLoading />
}

function SharedArtifactCollectionScope({
	artifactId,
	shareKey,
	permission,
}: {
	artifactId: string
	shareKey: string
	permission: 'view' | 'comment'
}) {
	const collection = useSharedArtifactCollection({ artifactId, shareKey })
	const { data, isError, isLoading } = useLiveQuery(
		(q) => q.from({ artifacts: collection }).where(({ artifacts }) => eq(artifacts.id, artifactId)),
		[collection, artifactId],
	)
	const artifact = data?.[0]

	if (isLoading) return <SharedArtifactLoading />
	if (isError || !artifact) return <SharedArtifactUnavailable />
	// S3 artifacts (HTML, images, PDFs) sync with empty content and cannot take comments, so they
	// render from a presigned URL in the file viewer, as signed-in generic artifacts do.
	if (artifact.storage_type === 's3') {
		return (
			<SharedArtifactShell title={artifact.file_name} permission="view">
				<SharedStoredFileViewer artifactId={artifactId} shareKey={shareKey} fileName={artifact.file_name} />
			</SharedArtifactShell>
		)
	}
	return permission === 'comment' ? (
		<SharedArtifactCommentScope artifact={artifact} artifactId={artifactId} shareKey={shareKey} />
	) : (
		<SharedArtifactShell title={artifact.file_name} permission="view">
			<SharedArtifactViewer artifactId={artifactId} artifact={artifact} review={null} />
		</SharedArtifactShell>
	)
}

function SharedArtifactCommentScope({
	artifact,
	artifactId,
	shareKey,
}: {
	artifact: SharedArtifactContent
	artifactId: string
	shareKey: string
}) {
	const { review, identityDialog } = useShareLinkArtifactReview({ artifactId, shareKey })

	return (
		<SharedArtifactShell title={artifact.file_name} permission="comment">
			<SharedArtifactViewer artifactId={artifactId} artifact={artifact} review={review} />
			<GuestCommentIdentityDialog
				open={identityDialog.open}
				onSubmit={identityDialog.onSubmit}
				onBack={identityDialog.onBack}
			/>
		</SharedArtifactShell>
	)
}

type SharedArtifactContent = { content: string; file_name: string }

function SharedArtifactViewer({
	artifactId,
	artifact,
	review,
}: {
	artifactId: string
	artifact: SharedArtifactContent
	review: ArtifactReview | null
}) {
	const [viewMode, setViewMode] = useState<ArtifactViewMode>('rendered')
	return (
		// flex-col stretches the viewer across the row: its inline-size containment gives it no
		// intrinsic width, so as a row flex item it would shrink to 0px.
		<div className="mx-auto flex w-full max-w-[80rem] flex-col p-6">
			{/* Fullscreen presentation: no split-view pane chrome, rail open by default, and no
			    keyboard ownership, since the app's fullscreen overlay is never open here. */}
			<ArtifactViewerV2
				artifactId={artifactId}
				review={review}
				content={artifact.content}
				fileName={artifact.file_name}
				displayMode="fullscreen"
				viewMode={viewMode}
				onViewModeChange={setViewMode}
				showDiffTab={false}
			/>
		</div>
	)
}

const DOWNLOAD_URL_STALE_TIME_MS = 45 * 60 * 1000

function SharedStoredFileViewer({
	artifactId,
	shareKey,
	fileName,
}: {
	artifactId: string
	shareKey: string
	fileName: string
}) {
	const { queryClient: api } = useRiptideApi()
	const download = useQuery({
		...api.public.artifacts.downloadUrl.queryOptions({ input: { artifactId, shareKey } }),
		staleTime: DOWNLOAD_URL_STALE_TIME_MS,
		retry: false,
	})
	const [view, setView] = useState<'rendered' | 'raw'>('rendered')

	if (download.isLoading) return <SharedArtifactLoadingBody />
	if (download.isError) return <SharedArtifactUnavailableBody />
	return (
		<div className="mx-auto w-full max-w-[80rem] p-6">
			<ArtifactViewer
				content=""
				fileName={fileName}
				imageUrl={download.data?.downloadUrl ?? null}
				storageType="s3"
				tabValue={clampArtifactViewMode(fileName, view)}
				onTabValueChange={(value) => {
					if (value !== 'diff') setView(value)
				}}
				showDownloadButton
				showHotkeyHints={false}
			/>
		</div>
	)
}

function SharedArtifactLoading() {
	return (
		<SharedArtifactShell>
			<SharedArtifactLoadingBody />
		</SharedArtifactShell>
	)
}

function SharedArtifactLoadingBody() {
	return (
		<div className="flex min-h-[50vh] w-full items-center justify-center" aria-label="Loading shared artifact">
			<SyncGridAnimation variant="snake" speed={120} className="w-8 text-muted-foreground" />
		</div>
	)
}

function SharedArtifactUnavailable() {
	return (
		<SharedArtifactShell>
			<SharedArtifactUnavailableBody />
		</SharedArtifactShell>
	)
}

function SharedArtifactUnavailableBody() {
	return (
		<div className="flex min-h-[50vh] w-full items-center justify-center p-6">
			<Card className="max-w-md p-8 text-center">
				<FileQuestion className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
				<h1 className="mb-2 font-mono text-base font-medium">Shared artifact unavailable</h1>
				<p className="text-sm text-muted-foreground">
					This link may have been turned off, or you may need to sign in with an account that has access.
				</p>
			</Card>
		</div>
	)
}

import type { Editor } from '@tiptap/react'
import type { RefCallback, RefObject } from 'react'

import type { AnchorV2, CommentKind } from '../anchor/types'
import type {
	ArtifactCommentProjectionRow,
	CommentProjectionIdentity,
	ProjectedCommentThread,
} from '../comments/project-comments'
import type { CreateV2CommentInput, CreateV2ReplyInput } from '../comments/optimistic-create'
import type { BlockCommentSubmission } from '../compose/BlockCommentComposer'
import type { OutlineItem } from '../toc/build-outline'
import type { CountedOutlineItem } from '../toc/comment-counts'
import type { NavigableBlock } from '../viewer/build-navigable-blocks'
import type { CommentHighlightRange } from '../viewer/CommentHighlightExtension'
import type { SelectionIntent } from '../viewer/selection'
import type { UseMarkdownViewerV2EditorOptions } from '../viewer/useMarkdownViewerV2Editor'
import type { ArtifactTracePort } from '../trace/artifact-side-panel-trace'

/**
 * (2) WRITE port. The optimistic create/delete actions built app-side by each
 * app's `commentActions.ts` (`createArtifactCommentV2Actions`), which itself
 * reuses `createV2CommentPersistence` verbatim. The controller consumes the two
 * actions so the create/delete verdict flows are identical across apps.
 *
 * NOTE: the raw `V2CommentPersistenceAdapter` covers only the CREATE path; the
 * `z`-undo delete needs an app-side optimistic `collection.update` (Electric,
 * `@tanstack/react-db`), which cannot live in `packages/ui`. Keeping the actions
 * app-side and injecting them here keeps that I/O where it belongs while the
 * decision logic stays in the controller.
 */
export interface ArtifactCommentPersistence {
	/**
	 * Optimistically insert + persist + confirm a V2 comment/verdict row. Returns
	 * the app's optimistic-action result (a TanStack `Transaction`); the controller
	 * `await`s it exactly as the two apps did before, so the return is intentionally
	 * `unknown` to avoid coupling `packages/ui` to `@tanstack/react-db`.
	 */
	createComment: (input: CreateV2CommentInput) => unknown
	/** Soft-delete + confirm a stacked verdict (the `z`-undo path). */
	deleteComment: (input: { commentId: string }) => unknown
	/**
	 * Optimistically insert + persist + confirm a reply row flattened under its
	 * V2 root (via the existing `comments.create` + `replyToCommentId` contract).
	 * No anchor, no typed kind — the reply's context comes from the root.
	 */
	createReply: (input: CreateV2ReplyInput) => unknown
	/** Edit a comment when the application adapter grants authorship. */
	editComment?: (input: { commentId: string; contentText: string; contentJson: unknown }) => unknown
	/**
	 * Optimistically resolve/unresolve a whole thread (via the existing
	 * `comments.resolve` contract). `commentId` is the root; the server cascades
	 * the state across every non-deleted reply. The optimistic path flips the
	 * root row's `is_resolved` so the projection re-partitions immediately.
	 */
	resolveComment: (input: { commentId: string; isResolved: boolean }) => unknown
}

/**
 * (3) READ port. Raw synced rows + author identities; the projection
 * (`projectArtifactComments`) runs INSIDE the controller against its own
 * `editor.state.doc`.
 */
export interface CommentFeed {
	/** The artifact-scoped live-query snapshot, unprojected. */
	rows: ArtifactCommentProjectionRow[]
	/** userId → display identity; the exact map `projectArtifactComments` consumes. */
	authors: ReadonlyMap<string, CommentProjectionIdentity>
}

/**
 * (4) Per-app hotkey scope + navigation-gating arbitration. Scopes are typed as
 * plain strings so no app scope constant leaks into `packages/ui`; each app
 * passes its own `HOTKEY_SCOPES` values.
 */
export interface KeyboardScopeBinding {
	/** Scopes the document keys (j/k/h/l/c/⇧J/⇧K) register in. */
	documentScopes: readonly string[]
	/** Scopes for host-page affordances (⇧O/⇧C) — riptide-ui widens these. */
	toggleScopes: readonly string[]
	/** Review-only scope for the instant a/d/z verdict keys (shadows host scope). */
	reviewScope: string
	/** Master enable (riptide-ui: command palette closed). */
	enabled: boolean
	/** Navigation enable (riptide-ui: enabled AND artifact pane owns keyboard focus). */
	navigationEnabled: boolean
	/** Find keys belong to this mounted viewer. */
	searchEnabled: boolean
}

export interface ArtifactSearchView {
	isOpen: boolean
	query: string
	currentIndex: number
	totalMatches: number
	inputRef: RefObject<HTMLInputElement | null>
	open: () => void
	close: () => void
	setQuery: (query: string) => void
	next: () => void
	previous: () => void
}

/**
 * (5) Minimal focus-store slice for the keyboard-nav legend.
 */
export interface FocusSurface {
	/** True while the last document keypress was a nav key (h/j/k/l). */
	lastNavWasHotkey: boolean
	/** Show/hide the legend: true on nav, false on action key / mouse focus / Escape. */
	setLastNavWasHotkey: (value: boolean) => void
}

/**
 * The identity scalars a persisted comment/verdict row carries. An
 * authenticated viewer passes the task scope (`taskId`, `resourceOwnerUserId`,
 * `organizationId`); its writes wait until `organizationId`/`userId` resolve.
 * A share-link viewer omits the task scope: the server derives it from the
 * link, and the persistence adapter asks the guest who they are at write time.
 */
export interface ArtifactReviewIdentity {
	artifactId: string
	userId: string | undefined
	taskId?: string
	resourceOwnerUserId?: string
	organizationId?: string
}

export type ArtifactReadingSurface = 'sidebar' | 'fullscreen'

/** Per-mounted-viewer DOM handoff; never persisted with artifact data. */
export interface ArtifactPresentationHandle {
	preparePresentationChange(): void
	completePresentationChange(): void
	/** Let an explicit heading/comment navigation replace the captured reading position. */
	cancelPendingRestoration(): void
}

export interface ArtifactScrollSnapshot {
	artifactId: string
	scrollTop: number
	anchor: AnchorV2 | null
	anchorViewportOffset: number
	keyboardFocused: boolean
	revision: number
	writer: ArtifactReadingSurface
}

export type ArtifactScrollSnapshotInput = Omit<ArtifactScrollSnapshot, 'revision'>

/** Transient app-owned state used across content-keyed viewer lifetimes. */
export interface ArtifactScrollRestorationPort {
	snapshot: ArtifactScrollSnapshot | null
	publishSnapshot: (snapshot: ArtifactScrollSnapshotInput) => void
	ownsReadingFocus: boolean
	writer: ArtifactReadingSurface
}

/** Optional app-owned fold state shared by every surface for one artifact. */
export interface ArtifactFoldPort {
	foldedHeadingIds: ReadonlySet<string>
	setFoldedHeadingIds: (foldedHeadingIds: ReadonlySet<string>) => void
}

export type ArtifactOutlinePreference = 'auto' | 'open' | 'closed'

/** Optional app-owned preference for responsive outline visibility. */
export interface ArtifactOutlinePreferencePort {
	preference: ArtifactOutlinePreference
	setPreference: (preference: ArtifactOutlinePreference) => void
}

/**
 * The complete input surface for {@link useArtifactController}. Document
 * configuration is data rather than an injected editor port: the controller
 * constructs the editor so selection handling and review state share one
 * lifecycle without an app-side ref bridge.
 */
export interface ArtifactControllerPorts {
	document: UseMarkdownViewerV2EditorOptions
	persistence: ArtifactCommentPersistence
	comments: CommentFeed
	keyboard: KeyboardScopeBinding
	focus: FocusSurface
	identity: ArtifactReviewIdentity
	presentation?: ArtifactReadingSurface
	scrollRestoration?: ArtifactScrollRestorationPort
	folds?: ArtifactFoldPort
	outlinePreference?: ArtifactOutlinePreferencePort
	/**
	 * Initial comment-rail visibility for this mount (default open). ⇧C and the
	 * corner toggle still flip it afterwards; narrow containers still collapse it.
	 */
	commentRailDefaultOpen?: boolean
	trace?: ArtifactTracePort
	traceInstanceId?: string
}

/**
 * The returned view-model — data the app spreads into the `packages/ui` Pure
 * shells (`ArtifactOutline` / `MarkdownViewerV2` / `ArtifactReviewRail` /
 * `CommentGutterOverlayV2` / `SelectionToolbar` / `BlockCommentComposer`). Never
 * components.
 */
export interface ArtifactControllerView {
	presentationHandle: ArtifactPresentationHandle
	/** Ensures even a batched, net-zero mode roundtrip receives a commit applier. */
	presentationChangeRevision: number
	layoutRevision: number
	// --- editor + document host ---
	editor: Editor | null
	viewerContainerRef: RefCallback<HTMLDivElement>
	documentScrollRef: (el: HTMLElement | null) => void
	syncScrollRestoration: (node: HTMLSpanElement | null) => void
	search: ArtifactSearchView

	// --- outline (ArtifactOutline) ---
	outlineItems: CountedOutlineItem[]
	outlineOpen: boolean
	onToggleOutline: () => void
	onOutlineItemClick: (item: OutlineItem) => void

	// --- document (MarkdownViewerV2 / comment document layer) ---
	blocks: NavigableBlock[]
	onFoldToggle: (headingId: string) => void
	onHeadingLinkNavigate: (headingId: string) => boolean
	showFocusHotkeys: boolean
	focusHotkeysCollapsed: boolean
	onToggleFocusHotkeys: () => void

	// --- review projection (ArtifactReviewRail / gutter / highlights) ---
	threads: ProjectedCommentThread[]
	/** Resolved threads for the rail's collapsed Resolved section (no highlights). */
	resolvedThreads: ProjectedCommentThread[]
	highlights: CommentHighlightRange[]
	activateThread: (rootId: string, options: { reveal: 'rail' | 'document' }) => void
	hoverThread: (rootId: string | null) => void
	/** Callback ref for the rail's scroll container (counterpart scroll targeting). */
	railRef: RefObject<HTMLElement | null>
	/**
	 * Callback ref for a hidden `<span>` the app renders once; pushes the current
	 * highlight projection into the editor when the editor/projection changes.
	 */
	syncHighlights: (node: HTMLSpanElement | null) => void

	// --- pending target + toolbar (SelectionToolbar) ---
	selectionToolbar: { rect: DOMRect } | null
	pendingRange: SelectionIntent | null
	commentRailOpen: boolean
	onToggleCommentRail: () => void

	// --- composer (BlockCommentComposer) ---
	composer: { anchor: AnchorV2; rect: DOMRect } | null
	onRequestCompose: (block: NavigableBlock) => void
	onCommentSelection: () => void
	onDismissSelection: () => void
	/** Soft-close the composer while retaining its exact target and decoration. */
	onComposeClose: () => void
	/** Fully dismiss the composer target, including its pending decoration. */
	onComposeDismiss: () => void
	submitComment: (submission: BlockCommentSubmission) => Promise<boolean>

	// --- verdicts (SelectionToolbar Delete/Approve + d/a/z keys) ---
	submitVerdict: (kind: 'deletion' | 'approval') => void
	undoVerdict: () => void

	// --- thread replies (rail ReplyComposer + review-scope `c`) ---
	/**
	 * The root comment whose reply composer is open, or null. Only one reply
	 * composer is open per rail at a time; its draft is keyed by root comment ID.
	 */
	replyComposerRootId: string | null
	/** Open the reply composer for a thread, preserving the root's activation. */
	onOpenReplyComposer: (rootId: string) => void
	/** Soft-close the reply composer (the per-thread draft survives). */
	onCloseReplyComposer: () => void
	/** Persist a reply flattened under the given root; resolves true on confirm. */
	submitReply: (rootCommentId: string, contentText: string) => Promise<boolean>

	// --- thread resolution (rail Resolve/Reopen controls + `r` key) ---
	/** Resolve a whole thread (root + replies) through the server cascade. */
	onResolveThread: (rootCommentId: string) => void
	/** Reopen a resolved thread; its root V2 decoration returns in document order. */
	onReopenThread: (rootCommentId: string) => void

	// --- comment deep links (route-driven one-shot reveal) ---
	/**
	 * The narrow seam route adapters use to reveal a linked thread once. The
	 * decision itself is pure (`decideCommentDeepLink` over `threads` /
	 * `resolvedThreads`); these controls are transient — they never set a
	 * persistent active thread, never mutate the comment focus store, and leave keyboard
	 * block focus untouched.
	 */
	deepLink: {
		/** True once the comment projection has resolved against the live document. */
		ready: boolean
		/** Transient scroll + short emphasis on an anchored open thread's document block. */
		revealInDocument: (rootId: string) => void
		/** Open the comment rail so a rail-target reveal can render its card. */
		openCommentRail: () => void
	}

	// --- review-scope activation (ArtifactTargetHotkeyBoundary) ---
	targetActive: boolean
	/** A retained block can hand the next Escape to its sidebar/fullscreen host. */
	hostEscapeReady: boolean

	currentUserDisplayName: string | undefined
	currentUserAvatarUrl: string | undefined
}

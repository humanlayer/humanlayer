import { useQuery } from '@tanstack/react-query'
import { useDebounce } from '@uidotdev/usehooks'
import { useRef } from 'react'
import type { Control } from 'react-hook-form'
import { useController, useWatch } from 'react-hook-form'

import { useMountEffect } from '@/hooks/useMountEffect'
import { TITLE_GENERATION_DEBOUNCE_MS } from '@/hooks/useTitleAutoGenerate'
import { generateLauncherTaskSlug } from '@/lib/launcher-task-slug'
import { generateTaskSlug } from '@/lib/task-slug'
import type { LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'
import { useRiptideApi } from '@/orpc/client'
import { getTextFromContent } from '@/utils/tiptap-content'

import { LauncherIdentity } from './LauncherIdentity'

/** Runs its callback when the keyed ticket identity mounts (attach or replace). */
function ApplyTicketIdentity({ apply }: { apply: () => void }) {
	useMountEffect(() => {
		apply()
	})
	return null
}

export interface LauncherIdentityWiredProps {
	control: Control<LauncherV3FormValues>
	disabled?: boolean
	onGeneratedIdentity?: () => void
}

/** Recognize generated initial values without drawing randomness during render. */
function initialGeneratedSlug(title: string, slug: string): string | null {
	const suffix = slug.slice(-6)
	return /^[a-z0-9]{6}$/.test(suffix) && slug === generateLauncherTaskSlug(title, () => suffix) ? slug : null
}

export function LauncherIdentityWired({ control, disabled, onGeneratedIdentity }: LauncherIdentityWiredProps) {
	const { field: title } = useController({ control, name: 'title' })
	const { field: slug } = useController({ control, name: 'slug' })
	const prompt = useWatch({ control, name: 'prompt' })
	const ticket = useWatch({ control, name: 'ticket' })
	const { queryClient: api } = useRiptideApi()

	const promptText = getTextFromContent(prompt ?? null).trim()
	const debouncedPromptText = useDebounce(promptText, TITLE_GENERATION_DEBOUNCE_MS)

	// A manual title wins and suppresses regeneration until the user clears it.
	const lastGeneratedTitle = useRef<string | null>(null)
	const lastGeneratedSlug = useRef(initialGeneratedSlug(title.value, slug.value))
	const titleFollowsGeneration = title.value.trim() === '' || title.value === lastGeneratedTitle.current
	const slugFollowsTitle =
		slug.value.trim() === '' ||
		slug.value === lastGeneratedSlug.current ||
		slug.value === generateTaskSlug(title.value)

	const applyGeneratedTitle = (generated: string, slugOverride?: string) => {
		const trimmed = generated.trim()
		if (!trimmed || !titleFollowsGeneration || trimmed === title.value) return
		const generatedSlug = generateLauncherTaskSlug(slugOverride?.trim() || trimmed)
		lastGeneratedTitle.current = trimmed
		title.onChange(trimmed)
		if (slugFollowsTitle) {
			lastGeneratedSlug.current = generatedSlug
			slug.onChange(generatedSlug)
		}
		if ((slugFollowsTitle ? generatedSlug : slug.value).trim()) onGeneratedIdentity?.()
	}

	// Generation reacts to prompt edits, never to submit-driven disable toggles:
	// once a response for the current text has arrived, only newer text (or a
	// cleared title) fetches again. Otherwise the enabled flicker from cmd+enter
	// would refetch the stale query even though nothing changed.
	const lastGeneratedForText = useRef<string | null>(null)
	// An attached ticket owns the identity: its resolved name replaces prompt
	// generation until the ticket is removed or the user edits the title.
	const generationEnabled =
		!disabled &&
		!ticket &&
		debouncedPromptText.length > 0 &&
		titleFollowsGeneration &&
		(debouncedPromptText !== lastGeneratedForText.current || title.value.trim() === '')
	const baseOptions = api.ai.generateTitle.queryOptions({
		input: { text: debouncedPromptText },
		context: { silent: true },
	})
	const titleQuery = useQuery({
		...baseOptions,
		enabled: generationEnabled,
		queryFn: async (queryContext) => ({
			...(await baseOptions.queryFn(queryContext)),
			generatedForText: debouncedPromptText,
		}),
	})

	const changeTitle = (value: string) => {
		title.onChange(value)
		if (slugFollowsTitle && value !== title.value) {
			const generatedSlug = generateLauncherTaskSlug(value)
			lastGeneratedSlug.current = generatedSlug
			slug.onChange(generatedSlug)
		}
	}

	const ticketName = ticket?.name.trim() ?? ''
	const generatedTitle = titleQuery.data
	return (
		<>
			{generatedTitle?.generatedForText === debouncedPromptText && (
				<ApplyTicketIdentity
					key={titleQuery.dataUpdatedAt}
					apply={() => {
						lastGeneratedForText.current = generatedTitle.generatedForText
						applyGeneratedTitle(generatedTitle.title)
					}}
				/>
			)}
			{ticketName && (
				<ApplyTicketIdentity
					key={`${ticket?.provider}:${ticket?.ticketId}`}
					apply={() => applyGeneratedTitle(ticketName, ticket?.slug)}
				/>
			)}
			<LauncherIdentity
				title={title.value}
				slug={slug.value}
				generating={generationEnabled && titleQuery.isFetching}
				disabled={disabled}
				onTitleChange={changeTitle}
				onTitleBlur={title.onBlur}
				onSlugChange={slug.onChange}
				onSlugBlur={slug.onBlur}
			/>
		</>
	)
}

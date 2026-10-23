import { Button } from '@humanlayer/ui/components/button'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { cn } from '@humanlayer/ui/lib/utils'
import { Pencil } from 'lucide-react'
import { type ComponentProps, useState } from 'react'

const INPUT_TEXT_CLASS = 'font-mono text-sm'
const INPUT_CLASS = `w-full min-w-0 border-0 bg-transparent p-0 outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${INPUT_TEXT_CLASS}`

/**
 * Text input that grows with its value. An invisible mirror span sets the
 * width (field-sizing: content is not available in WebKit), so the edit state
 * occupies the same footprint as the read state it replaces.
 */
function IdentityInput({ className, value, placeholder, ...props }: ComponentProps<'input'> & { value: string }) {
	return (
		<span className="inline-grid max-w-full min-w-0">
			<span
				aria-hidden
				className={cn('invisible col-start-1 row-start-1 overflow-hidden whitespace-pre', INPUT_TEXT_CLASS)}
			>
				{value || placeholder}
			</span>
			<input
				className={cn('col-start-1 row-start-1', INPUT_CLASS, className)}
				value={value}
				placeholder={placeholder}
				{...props}
			/>
		</span>
	)
}

export interface LauncherIdentityProps {
	title: string
	slug: string
	generating: boolean
	disabled?: boolean
	onTitleChange: (value: string) => void
	onTitleBlur: () => void
	onSlugChange: (value: string) => void
	onSlugBlur: () => void
}

function GeneratingIdentitySpinner() {
	return (
		<span role="status" aria-label="Generating title and slug" className="ml-auto flex shrink-0 items-center">
			<SyncGridAnimation variant="ring" synchronized size="sm" className="text-[var(--terminal-success)]" />
		</span>
	)
}

/**
 * Inline task identity: the generated or manual title and dimmed slug on one
 * line, each clickable to edit in place. Hidden until a value or generation
 * feedback exists.
 */
export function LauncherIdentity({
	title,
	slug,
	generating,
	disabled = false,
	onTitleChange,
	onTitleBlur,
	onSlugChange,
	onSlugBlur,
}: LauncherIdentityProps) {
	const [editing, setEditing] = useState<'title' | 'slug' | null>(null)
	const startEditingSlug = () => setEditing('slug')

	if (!title.trim() && !slug.trim() && editing === null) {
		if (!generating) return null
		return (
			<section aria-label="Task identity" className="flex min-h-6 w-full items-center px-0.5">
				<GeneratingIdentitySpinner />
			</section>
		)
	}

	const stopEditing = (field: 'title' | 'slug', blur: () => void) => {
		setEditing((current) => (current === field ? null : current))
		blur()
	}

	return (
		<section
			aria-label="Task identity"
			className="flex min-h-6 w-full min-w-0 flex-wrap items-center gap-3 px-0.5 text-sm"
		>
			{editing === 'title' ? (
				<IdentityInput
					aria-label="Task title"
					value={title}
					placeholder="Task title"
					autoFocus
					disabled={disabled}
					onFocus={(event) => event.currentTarget.select()}
					onChange={(event) => onTitleChange(event.currentTarget.value)}
					onBlur={() => stopEditing('title', onTitleBlur)}
					onKeyDown={(event) => {
						if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur()
					}}
				/>
			) : (
				<button
					type="button"
					className="min-w-0 cursor-pointer truncate text-left transition-colors hover:text-[var(--terminal-accent)]"
					title="Edit title"
					disabled={disabled}
					onClick={() => setEditing('title')}
				>
					{title.trim() || 'Add title'}
				</button>
			)}
			{editing === 'slug' ? (
				<IdentityInput
					aria-label="Task slug"
					className="text-muted-foreground"
					value={slug}
					placeholder="task-slug"
					autoFocus
					disabled={disabled}
					spellCheck={false}
					onFocus={(event) => event.currentTarget.select()}
					onChange={(event) => onSlugChange(event.currentTarget.value)}
					onBlur={() => stopEditing('slug', onSlugBlur)}
					onKeyDown={(event) => {
						if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur()
					}}
				/>
			) : (
				<span className="flex min-w-0 items-center gap-1">
					<button
						type="button"
						className={cn(
							'min-w-0 cursor-pointer truncate text-left text-muted-foreground transition-colors hover:text-[var(--terminal-accent)]',
							!slug.trim() && 'italic',
						)}
						title="Edit slug"
						disabled={disabled}
						onClick={startEditingSlug}
					>
						{slug.trim() || 'Add slug'}
					</button>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="h-6 w-6 shrink-0"
								aria-label="Edit task slug"
								disabled={disabled}
								onClick={startEditingSlug}
							>
								<Pencil
									aria-hidden
									className="h-3.5 w-3.5 text-accent transition-colors hover:text-accent/80"
								/>
							</Button>
						</TooltipTrigger>
						<TooltipContent>Edit slug</TooltipContent>
					</Tooltip>
				</span>
			)}
			{generating && <GeneratingIdentitySpinner />}
		</section>
	)
}

import { Field, FieldError, FieldLabel } from '@humanlayer/ui/components/field'
import { Input } from '@humanlayer/ui/components/input'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'

export interface GitHubIssueInputProps {
	readonly value: string
	readonly onChange: (value: string) => void
	readonly isFetching?: boolean
	readonly disabled?: boolean
	readonly error?: string | null
}

export function GitHubIssueInput({
	value,
	onChange,
	isFetching = false,
	disabled = false,
	error,
}: GitHubIssueInputProps) {
	return (
		<Field data-invalid={Boolean(error)}>
			<FieldLabel htmlFor="github-issue-input">GitHub issue number or URL</FieldLabel>
			<div className="relative">
				<Input
					id="github-issue-input"
					value={value}
					onChange={(event) => onChange(event.target.value)}
					placeholder="123 or https://github.com/acme/web/issues/123"
					className="font-mono pr-8"
					disabled={disabled}
					aria-invalid={Boolean(error)}
				/>
				{isFetching && (
					<SyncGridAnimation
						variant="snake"
						size="sm"
						speed={120}
						className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
					/>
				)}
			</div>
			{error && <FieldError errors={[{ message: error }]} />}
		</Field>
	)
}

import { Button } from '@humanlayer/ui/components/button'
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@humanlayer/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@humanlayer/ui/components/popover'
import { cn } from '@humanlayer/ui/lib/utils'
import { Check, ChevronsUpDown, EyeOff } from 'lucide-react'
import { useId, useState } from 'react'

export interface GitHubRepositoryOption {
	readonly connectionId: string
	readonly repositoryId: string
	readonly fullName: string
	readonly accountLogin: string
	readonly private: boolean
	readonly archived: boolean
}

export interface GitHubRepositoryPickerProps {
	readonly repositories: ReadonlyArray<GitHubRepositoryOption>
	readonly selectedRepositoryId: string | null
	readonly onSelect: (repository: GitHubRepositoryOption) => void
	readonly disabled?: boolean
	readonly ariaLabel?: string
}

export function GitHubRepositoryPicker({
	repositories,
	selectedRepositoryId,
	onSelect,
	disabled = false,
	ariaLabel = 'Select an installed repository',
}: GitHubRepositoryPickerProps) {
	const [open, setOpen] = useState(false)
	const listboxId = useId()
	const selectedRepository = repositories.find((repository) => repository.repositoryId === selectedRepositoryId)

	const handleSelect = (repository: GitHubRepositoryOption) => {
		onSelect(repository)
		setOpen(false)
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					role="combobox"
					aria-label={ariaLabel}
					aria-expanded={open}
					aria-controls={listboxId}
					disabled={disabled || repositories.length === 0}
					className={cn(
						'group w-full justify-between font-normal normal-case tracking-normal',
						!selectedRepository && 'text-muted-foreground',
					)}
				>
					<span className="flex min-w-0 items-center gap-2">
						<span className="truncate font-mono text-xs">
							{selectedRepository?.fullName ?? 'Select an installed repository'}
						</span>
						{selectedRepository?.private && (
							<EyeOff
								className="size-3.5 shrink-0 text-muted-foreground"
								aria-label="Private repository"
							/>
						)}
					</span>
					<ChevronsUpDown className="ml-2 size-4 shrink-0 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="w-auto min-w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-content-available-width)] p-0 md:min-w-[32rem]"
				align="start"
			>
				<Command>
					<CommandInput placeholder="Search installed repositories..." />
					<CommandList id={listboxId}>
						<CommandEmpty>
							{repositories.length === 0
								? 'No repositories available'
								: 'No installed repositories match'}
						</CommandEmpty>
						<CommandGroup>
							{repositories.map((repository) => {
								const isSelected = repository.repositoryId === selectedRepositoryId
								return (
									<CommandItem
										key={`${repository.connectionId}:${repository.repositoryId}`}
										value={`${repository.connectionId}:${repository.repositoryId}`}
										keywords={[repository.fullName, repository.accountLogin]}
										onSelect={() => handleSelect(repository)}
										disabled={repository.archived}
										className="group gap-2"
									>
										<Check
											className={cn('size-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')}
										/>
										<span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
											{repository.fullName}
										</span>
										{repository.archived && (
											<span className="shrink-0 text-xs text-muted-foreground group-data-[selected=true]:text-background">
												Archived
											</span>
										)}
										{repository.private && (
											<EyeOff
												className="size-3.5 shrink-0 text-muted-foreground group-data-[selected=true]:text-background"
												aria-label="Private repository"
											/>
										)}
									</CommandItem>
								)
							})}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	)
}

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@humanlayer/ui/components/input-group'
import { Trash2 } from 'lucide-react'

interface DomainInputRowProps {
	value: string
	onChange: (value: string) => void
	onRemove: () => void
	disabled?: boolean
	error?: string
}

export function DomainInputRow({ value, onChange, onRemove, disabled, error }: DomainInputRowProps) {
	return (
		<InputGroup>
			<InputGroupInput
				value={value}
				onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
				placeholder="example.com"
				disabled={disabled}
				aria-invalid={!!error}
			/>
			<InputGroupAddon align="inline-end">
				<InputGroupButton
					type="button"
					variant="ghost"
					size="icon-xs"
					onClick={onRemove}
					disabled={disabled}
					aria-label="Remove domain"
					className="text-destructive hover:bg-destructive hover:text-background"
				>
					<Trash2 className="size-4" />
				</InputGroupButton>
			</InputGroupAddon>
		</InputGroup>
	)
}

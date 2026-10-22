import { Select, SelectContent, SelectItem, SelectTrigger } from '@humanlayer/ui/components/select'

import type { EditorType } from '@/hooks/stores/settingsStore'
import { EDITOR_OPTIONS } from '@/lib/preferences'

interface EditorSelectorProps {
	value: EditorType
	onValueChange: (value: EditorType) => void
}

export function EditorSelector({ value, onValueChange }: EditorSelectorProps) {
	return (
		<Select value={value} onValueChange={(v) => onValueChange(v as EditorType)}>
			<SelectTrigger className="w-[150px] shrink-0 h-8 px-2.5">
				<div className="flex items-center gap-1.5">
					<span>{EDITOR_OPTIONS.find((e) => e.value === value)?.label}</span>
				</div>
			</SelectTrigger>
			<SelectContent>
				{EDITOR_OPTIONS.map((editor) => (
					<SelectItem key={editor.value} value={editor.value}>
						<div className="flex flex-col gap-0.5">
							<span className="font-medium">{editor.label}</span>
							{editor.description && (
								<span className="text-sm opacity-70 group-data-[state=checked]:opacity-100">
									{editor.description}
								</span>
							)}
						</div>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}

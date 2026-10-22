import type { FC } from 'react'
import type { SkillToolInput } from '../types'

export const RpiSkillToolCallContent: FC<{
	skillInput: SkillToolInput
	color: string
	isCompleted?: boolean
	isFocused?: boolean
	isGroupItem?: boolean
	toolResultContent?: string
}> = ({ skillInput, color }) => (
	<div className="overflow-hidden text-sm relative top-[-2px]">
		<span className="text-sm font-semibold whitespace-nowrap leading-none" style={{ color }}>
			{skillInput.skill}
		</span>
		{skillInput.args && (
			<div className="text-foreground text-sm mt-1">
				{skillInput.args}
			</div>
		)}
	</div>
)

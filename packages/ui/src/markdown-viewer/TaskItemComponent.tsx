import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Checkbox } from '../components/checkbox'

export const TaskItemComponent: React.ComponentType<ReactNodeViewProps<HTMLElement>> = ({ node }) => {
	const checked = node.attrs.checked as boolean

	return (
		<NodeViewWrapper as="li" data-type="taskItem" data-checked={checked}>
			<label contentEditable={false}>
				<Checkbox checked={checked} disabled className="mt-0.5" />
			</label>
			<div>
				<NodeViewContent />
			</div>
		</NodeViewWrapper>
	)
}

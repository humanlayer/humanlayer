import type { FC } from 'react'

import { useFocusStore } from '@/hooks/stores/focusStore'

import { SessionTableRow, type SessionTableRowProps } from './SessionTableRow'

type WiredSessionTableRowProps = Omit<SessionTableRowProps, 'isFocused'>

export type SessionFocusCursor = 'session' | 'archived-session'

/** Store-backed row boundary so session cursor movement updates only the old and new rows. */
export const WiredSessionTableRow: FC<WiredSessionTableRowProps & { focusCursor: SessionFocusCursor }> = (props) => {
	const { focusCursor, ...rowProps } = props
	const isFocused = useFocusStore((state) =>
		focusCursor === 'archived-session'
			? state.focusedArchivedSessionId === props.session.id
			: state.focusedSessionId === props.session.id,
	)

	return <SessionTableRow {...rowProps} isFocused={isFocused} />
}

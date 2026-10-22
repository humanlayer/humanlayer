interface ShouldPinLatestUserMessageInput {
	rowStart: number | undefined
	rowEnd: number | undefined
	scrollTop: number
}

export function shouldPinLatestUserMessage({ rowStart, rowEnd, scrollTop }: ShouldPinLatestUserMessageInput): boolean {
	if (rowStart === undefined) return false
	return (rowEnd ?? rowStart) <= scrollTop
}

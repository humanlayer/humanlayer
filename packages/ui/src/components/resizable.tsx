"use client"

import { cn } from '@humanlayer/ui/lib/utils'
import * as ResizablePrimitive from 'react-resizable-panels'

function ResizablePanelGroup({
	className,
	...props
}: ResizablePrimitive.GroupProps) {
	return (
		<ResizablePrimitive.Group
			data-slot="resizable-panel-group"
			className={cn(
				'flex h-full w-full aria-[orientation=vertical]:flex-col',
				className,
			)}
			{...props}
		/>
	)
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
	return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
	withHandle,
	className,
	...props
}: ResizablePrimitive.SeparatorProps & {
	withHandle?: boolean
}) {
	return (
		<ResizablePrimitive.Separator
			data-slot="resizable-handle"
			className={cn(
				'relative flex w-4 cursor-col-resize items-center justify-center bg-transparent outline-hidden aria-[orientation=horizontal]:h-4 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:cursor-row-resize [&[aria-orientation=horizontal]>div]:rotate-90',
				className,
			)}
			{...props}
		>
			{withHandle && (
				<div className="z-10 flex h-8 w-1 shrink-0 rounded-none bg-muted-foreground/50 transition-[background-color] [[data-slot=resizable-handle]:hover_&]:bg-muted-foreground [[data-slot=resizable-handle]:active_&]:bg-primary" />
			)}
		</ResizablePrimitive.Separator>
	)
}

export type { PanelImperativeHandle } from 'react-resizable-panels'

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }

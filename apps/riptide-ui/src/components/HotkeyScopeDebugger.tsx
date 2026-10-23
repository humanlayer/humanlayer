import { useHotkeys, useHotkeysContext } from '@humanlayer/react-hotkeys-hook'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { useState } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'

import { scopeManager } from '../hooks/hotkeys/scopeManager'

export function HotkeyScopeDebugger() {
	const [stack, setStack] = useState(scopeManager.getStack())
	const [showDebugger, setShowDebugger] = useState(false)
	const { activeScopes } = useHotkeysContext()

	useMountEffect(() => {
		return scopeManager.subscribe(setStack)
	})

	// Global hotkey to toggle debugger visibility (dev mode only)
	useHotkeys(
		'alt+shift+h',
		() => {
			setShowDebugger(!showDebugger)
		},
		{
			// No scopes specified - works in wildcard scope
			enabled: import.meta.env.DEV,
			preventDefault: true,
		},
		[showDebugger],
	)

	if (!import.meta.env.DEV || !showDebugger) {
		return null
	}

	return (
		<div className="fixed top-4 right-4 bg-black/90 text-white p-4 rounded-lg max-w-md z-[9999]">
			<div className="flex justify-between items-center mb-2">
				<h3 className="text-xs font-bold">Hotkey Scope Stack</h3>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							onClick={() => setShowDebugger(false)}
							className="text-gray-400 hover:text-white text-xs"
							type="button"
						>
							x
						</button>
					</TooltipTrigger>
					<TooltipContent>
						<p className="flex items-center gap-1">
							Close <KeyboardShortcut>Alt+Shift+H</KeyboardShortcut>
						</p>
					</TooltipContent>
				</Tooltip>
			</div>
			<div className="space-y-1">
				<div className="text-xs">
					<span className="text-gray-400">Active Scopes:</span>
					<span className="ml-2 text-green-400">{activeScopes.join(', ')}</span>
				</div>
				<div className="text-xs">
					<span className="text-gray-400">Stack ({stack.length}):</span>
				</div>
				{stack.map((entry, index) => (
					<div
						key={entry.id}
						className={`text-xs pl-4 ${index === stack.length - 1 ? 'text-yellow-400' : 'text-gray-300'}`}
					>
						{index === stack.length - 1 && '> '}
						{entry.scope}
						{entry.component && ` (${entry.component})`}
						{entry.rootDisabled && ' [root disabled]'}
					</div>
				))}
			</div>
		</div>
	)
}

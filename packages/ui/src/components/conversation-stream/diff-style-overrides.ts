import type { CSSProperties } from 'react'

export const diffThemeStyleOverrides = {
	// Match the app's body font so diff code, headers, and chrome share one mono face.
	'--diffs-font-family': '"IBM Plex Mono", "Consolas", "Monaco", "Courier New", monospace',
	'--diffs-header-font-family': '"IBM Plex Mono", "Consolas", "Monaco", "Courier New", monospace',
	// Only syntax token colors come from the GitHub Shiki theme; every surface and
	// wash is app-owned so the diff reads as one theme instead of a patchwork of
	// GitHub grays over the app chrome. Code, buffer, and hunk separators all sit
	// on --terminal-bg; additions/deletions wash the theme success/error over it.
	'--diffs-bg': 'var(--terminal-bg)',
	'--diffs-dark-bg': 'var(--terminal-bg)',
	'--diffs-light-bg': 'var(--terminal-bg)',
	'--diffs-bg-buffer-override': 'var(--terminal-bg)',
	'--diffs-addition-color-override': 'var(--terminal-success)',
	'--diffs-deletion-color-override': 'var(--terminal-error)',
	'--diffs-modified-color-override': 'var(--terminal-accent)',
	'--diffs-bg-selection-override': 'var(--terminal-warning)',
	'--diffs-bg-selection-number-override': 'var(--terminal-warning)',
} as CSSProperties

export const diffLayoutUnsafeCSS = `
	:host {
		border-radius: 0 !important;
		--diffs-gap-block: 0px;
		--diffs-gap-fallback: 0px;
	}
	[data-code] {
		padding-top: 0 !important;
		padding-bottom: 0 !important;
	}
	[data-selected-line] {
		--mix-selection-light: 65%;
		--mix-selection-dark: 65%;
		box-shadow: inset 2px 0 0 color-mix(in srgb, var(--terminal-warning) 75%, transparent);
	}
	[data-selected-line]:not([data-selected-line='single']) {
		--mix-selection-light: 58%;
		--mix-selection-dark: 58%;
		box-shadow: inset 2px 0 0 var(--terminal-warning);
	}
	[data-selected-line='first'],
	[data-selected-line='last'] {
		box-shadow: inset 3px 0 0 var(--terminal-warning);
	}
	[data-column-number][data-selected-line] {
		color: var(--diffs-fg-number);
	}
	[data-column-number][data-selected-line][data-line-type='change-addition'] {
		color: var(--diffs-fg-number-addition-override, var(--diffs-addition-base));
	}
	[data-column-number][data-selected-line][data-line-type='change-deletion'] {
		color: var(--diffs-fg-number-deletion-override, var(--diffs-deletion-base));
	}
	[data-utility-button] {
		border-radius: 0 !important;
		background-color: var(--terminal-warning) !important;
		color: var(--terminal-bg) !important;
	}
	[data-utility-button]:hover {
		background-color: color-mix(in srgb, var(--terminal-warning) 82%, var(--terminal-fg)) !important;
	}
	[data-utility-button]:active {
		background-color: color-mix(in srgb, var(--terminal-warning) 68%, var(--terminal-fg)) !important;
	}
	[data-utility-button]:focus-visible {
		outline: 2px solid var(--terminal-warning) !important;
		outline-offset: 2px;
		box-shadow: 0 0 0 1px var(--terminal-bg);
	}
	[data-diff][data-type='split'][data-overflow='wrap'] {
		padding-block: 0 !important;
	}
	[data-separator-content],
	[data-separator-wrapper],
	[data-separator-wrapper] [data-expand-both],
	[data-separator-wrapper] [data-expand-down],
	[data-separator-wrapper] [data-expand-up] {
		border-radius: 0 !important;
		border-top-left-radius: 0 !important;
		border-top-right-radius: 0 !important;
		border-bottom-left-radius: 0 !important;
		border-bottom-right-radius: 0 !important;
	}
`

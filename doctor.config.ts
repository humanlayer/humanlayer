// doctor.config.ts
import { defineConfig } from 'react-doctor/api'

export default defineConfig({
	ignore: {
		// no-prevent-default: in the Tauri desktop app, <a> links intentionally call
		// preventDefault() and open via the native shell (openExternal/openUrl). Markdown
		// renderers emit semantic <a href> tags, so swapping to <button> would be worse.
		rules: [
			'react-doctor/no-danger',
			'react-doctor/no-prevent-default',
			'react-doctor/exhaustive-deps',
			// design-no-redundant-size-axes: opt-in style nit (w-N h-N vs size-N). 280
			// instances across the codebase — purely cosmetic, zero behaviour change.
			'react-doctor/design-no-redundant-size-axes',
			// jsx-boolean-value: opt-in style nit about boolean prop shorthand vs explicit
			// notation (e.g. `disabled` vs `disabled={true}`). Codebase mixes both styles
			// deliberately; enforcing one way adds churn without correctness benefit.
			'react-doctor/jsx-boolean-value',
			// no-generic-handler-names: `handleChange`, `handleFocus`, `handleBlur` are
			// idiomatic React event-handler naming conventions. Renaming low-level DOM
			// event callbacks to action-oriented names (e.g. `browseDirectory`) adds
			// confusion for standard form-input patterns without improving correctness.
			'react-doctor/no-generic-handler-names',
			// jsx-handler-names: hook-returned methods like `launch`, `reset`, `next`,
			// `prev`, `closeSearch`, `toggleSearch`, `setQuery` are deliberately named
			// as actions/setters on a hook API object, not event-handler callbacks. The
			// `on…` prefix convention applies to callback props, not to hook methods
			// exposed via an object. Enforcing the rename across 64+ sites adds churn
			// without improving correctness.
			'react-doctor/jsx-handler-names',
		],
		files: ['src/generated/**', 'src/**/*.stories.tsx', 'src/components/storybook/**', 'test/**/*'],
		overrides: [
			{
				// src/collections/ files export create…Collection factory functions and
				// get…Collection convenience wrappers as a deliberate library API surface.
				// The create… exports are used via `ReturnType<typeof create…>` for type
				// derivation (and are available for callers who want custom instances), even
				// when no direct runtime import exists at this moment.
				files: ['src/collections/**'],
				rules: ['deslop/unused-export'],
			},
			{
				// DiagnosticsSettingsSection: updateClaudeCode mutation already handles
				// cache freshness via refetchDiagnostics() in onSuccess. The query has
				// enabled:false (manual-only), so refetch() is the correct primitive here;
				// calling invalidateQueries would be redundant and cause a double-fetch.
				files: ['src/components/settings/DiagnosticsSettingsSection.tsx'],
				rules: ['react-doctor/query-mutation-missing-invalidation'],
			},
			{
				// These mutations orchestrate Tauri installation and TanStack DB actions.
				// They either relaunch the app or await collection sync directly, so there
				// is no query cache to invalidate after success.
				files: ['src/components/UpdateDetailsDialog.tsx', 'src/hooks/use-update.tsx'],
				rules: ['react-doctor/query-mutation-missing-invalidation'],
			},
			{
				// Multiplayer prompting writes await Electric transaction synchronization,
				// and organization enablement updates the settings store directly. Neither
				// mutation owns TanStack Query cache data that needs invalidation.
				files: ['src/components/session-detail/MultiplayerPromptingControl.tsx'],
				rules: ['react-doctor/query-mutation-missing-invalidation'],
			},
			{
				// Coding-agent probe mutations record results in a Zustand store, not the
				// React Query cache, so there is no query data to invalidate.
				files: ['src/components/onboarding/AgentSetupStep.tsx'],
				rules: ['react-doctor/query-mutation-missing-invalidation'],
			},
			{
				// RenameTaskDialog / RenameSessionDialog: the outer wrapper passes a key that
				// includes currentName (and isOpen), forcing the inner *Content component to
				// remount whenever the relevant prop changes — stale state is impossible.
				files: ['src/components/RenameTaskDialog.tsx', 'src/components/RenameSessionDialog.tsx'],
				rules: ['react-doctor/no-derived-useState'],
			},
			{
				// SessionTable: uses the React-recommended "adjust state during render"
				// pattern (prevProp comparison + inline setState) to sync editValue with
				// externalEditingSessionId without an effect — no stale state.
				files: ['src/components/session-table/SessionTable.tsx'],
				rules: ['react-doctor/no-derived-useState'],
			},
			{
				// "Latest ref" pattern: `ref.current = value` during render keeps a ref
				// pointing at the freshest prop/callback so effects and event handlers can
				// read it without stale-closure issues. This is an established React idiom
				// when useEffectEvent is unavailable; all mutations are write-only from
				// render and read-only from callbacks, so concurrency is safe.
				files: [
					'src/components/DiffCommentNotificationHandler.tsx',
					'src/components/Terminal/TerminalPanel.tsx',
					'src/components/conversation-stream/hooks/useConversationNavigation.ts',
					'src/components/launcher-v3/useLauncherV3LaunchAdapter.ts',
					'src/hooks/session-detail/useSessionSendControls.ts',
					'src/hooks/useCommandPaletteAction.ts',
					'src/mobile/components/wired/WiredMobileArtifactSheet.tsx',
				],
				rules: ['react-doctor/no-ref-current-in-render'],
			},
			{
				// MarkdownRendererFull: MermaidBlock, TaskArtifactBlock, and MarkdownRendererInner
				// must stay at module scope so Streamdown's block memoization works correctly —
				// Streamdown compares renderer/plugin identity and remounts blocks whenever the
				// reference changes. Splitting them into separate files would break the perf design.
				files: ['src/components/MarkdownRendererFull.tsx'],
				rules: ['react-doctor/no-multi-component-file'],
			},
			{
				// ProviderSignInCard: CopyButton, PasteCodeForm, AwaitingApproval,
				// ProviderSignInMessages, and ProviderSignInAction are tightly coupled
				// components that together form the sign-in card flow. They share types,
				// status helpers, and rendering patterns; extracting them into separate files
				// would fragment a single cohesive feature without improving clarity.
				files: ['src/components/provider-sign-in/ProviderSignInCard.tsx'],
				rules: ['react-doctor/no-multi-component-file'],
			},
			{
				// WorkspaceSetupCard: StateIcon, SetupOperationRow, FailureActions,
				// WorkspaceSetupRepoSuffix, and WorkspaceSetupRepoDetails are rendering
				// primitives that share stage/state logic and type definitions that are
				// specific to the workspace setup flow. Co-location is intentional.
				files: ['src/components/task-detail/WorkspaceSetupCard.tsx'],
				rules: ['react-doctor/no-multi-component-file'],
			},
			{
				// TanStack Router route file: SessionPhaseTipModal and SessionDetailLayout
				// are route-scoped helper components that depend on the Route object defined
				// in this file. Co-locating them avoids a circular-import problem and is the
				// idiomatic pattern for TanStack Router route files.
				files: ['src/routes/_app/sessions/$sessionId.tsx'],
				rules: ['react-doctor/no-multi-component-file'],
			},
		],
	},
	rules: {
		'react-doctor/no-array-index-as-key': 'off',
		'react-doctor/react-in-jsx-scope': 'off',
		'react-doctor/forbid-component-props': 'off',
		'react-doctor/react-compiler-no-manual-memoization': 'off',
		'react-hooks-js/todo': 'off',
	},
	categories: {
		Security: 'error',
		Bugs: 'error',
		Maintainability: 'error',
		Accessibility: 'warn',
		Performance: 'off',
	},
})

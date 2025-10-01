import { useStore } from "@/AppStore";
import {
	isViewingSessionDetail,
	useSessionLauncher,
} from "@/hooks/useSessionLauncher";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { KeyboardShortcut } from "./HotkeyPanel";

interface MenuOption {
	id: string;
	label: string;
	description?: string;
	action: () => void;
	sessionId?: string;
	hotkey?: string;
}

export default function CommandPaletteMenu() {
	const { createNewSession, selectedMenuIndex, setSelectedMenuIndex, close } =
		useSessionLauncher();

	const [searchQuery, setSearchQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	// Get sessions and state from the main app store
	const sessions = useStore((state) => state.sessions);
	const focusedSession = useStore((state) => state.focusedSession);
	const selectedSessions = useStore((state) => state.selectedSessions);
	const activeSessionDetail = useStore((state) => state.activeSessionDetail);
	const archiveSession = useStore((state) => state.archiveSession);
	const bulkArchiveSessions = useStore((state) => state.bulkArchiveSessions);
	const setSettingsDialogOpen = useStore(
		(state) => state.setSettingsDialogOpen,
	);

	// Check if we're viewing a session detail
	const isSessionDetail = isViewingSessionDetail();

	// Check if we should show archive option
	const isSessionTable = !isSessionDetail && window.location.hash === "#/";
	const shouldShowArchive =
		isSessionDetail ||
		(isSessionTable && (focusedSession || selectedSessions.size > 0));

	// Determine if we should show unarchive instead of archive
	const getArchiveLabel = (): string => {
		if (isSessionDetail && activeSessionDetail) {
			return activeSessionDetail.session.archived ? "Unarchive" : "Archive";
		} else if (selectedSessions.size > 0) {
			// For bulk operations, check if all selected sessions have same archive state
			const sessionIds = Array.from(selectedSessions);
			const sessionsToCheck = sessions.filter((s) => sessionIds.includes(s.id));
			const allArchived = sessionsToCheck.every((s) => s.archived);
			const allActive = sessionsToCheck.every((s) => !s.archived);

			// If mixed state, use "Archive" as default
			if (!allArchived && !allActive) {
				return "Archive";
			}
			return allArchived ? "Unarchive" : "Archive";
		} else if (focusedSession) {
			return focusedSession.archived ? "Unarchive" : "Archive";
		}
		return "Archive"; // Default
	};

	// Build base menu options
	const baseOptions: MenuOption[] = [
		{
			id: "create-session",
			label: "Create Session",
			action: createNewSession,
			hotkey: "C",
		},
		{
			id: "open-settings",
			label: "Settings",
			action: () => {
				setSettingsDialogOpen(true);
				close();
			},
			hotkey: "⌘+⇧+S",
		},
		...(isSessionDetail && searchQuery.toLowerCase().includes("brain")
			? [
					{
						id: "toggle-brainrot",
						label: "Brainrot Mode",
						action: () => {
							window.dispatchEvent(new CustomEvent("toggle-brainrot-mode"));
							close();
						},
					},
				]
			: []),
		...(shouldShowArchive
			? [
					{
						id: "archive-session",
						label: getArchiveLabel(),
						action: async () => {
							if (isSessionDetail && activeSessionDetail) {
								// Archive current session in detail view
								await archiveSession(
									activeSessionDetail.session.id,
									!activeSessionDetail.session.archived,
								);
								close();
							} else if (selectedSessions.size > 0) {
								// Bulk archive selected sessions
								const sessionIds = Array.from(selectedSessions);
								const sessionsToArchive = sessions.filter((s) =>
									sessionIds.includes(s.id),
								);
								const allArchived = sessionsToArchive.every((s) => s.archived);
								await bulkArchiveSessions(sessionIds, !allArchived);
								close();
							} else if (focusedSession) {
								// Archive focused session
								await archiveSession(
									focusedSession.id,
									!focusedSession.archived,
								);
								close();
							}
						},
						hotkey: "E",
					},
				]
			: []),
	];

	// Filter options based on search query
	const menuOptions = searchQuery
		? baseOptions.filter((option) =>
				option.label.toLowerCase().includes(searchQuery.toLowerCase()),
			)
		: baseOptions;

	// Keyboard navigation - only arrow keys
	useHotkeys(
		"up",
		() => {
			setSelectedMenuIndex(
				selectedMenuIndex > 0 ? selectedMenuIndex - 1 : menuOptions.length - 1,
			);
		},
		{ enabled: true, enableOnFormTags: true, scopes: "session-launcher" },
	);

	useHotkeys(
		"down",
		() => {
			setSelectedMenuIndex(
				selectedMenuIndex < menuOptions.length - 1 ? selectedMenuIndex + 1 : 0,
			);
		},
		{ enabled: true, enableOnFormTags: true, scopes: "session-launcher" },
	);

	useHotkeys(
		"enter",
		() => {
			if (menuOptions[selectedMenuIndex]) {
				menuOptions[selectedMenuIndex].action();
			}
		},
		{ enabled: true, enableOnFormTags: true, scopes: "session-launcher" },
	);

	// Reset selection when options change
	useEffect(() => {
		if (selectedMenuIndex >= menuOptions.length) {
			setSelectedMenuIndex(0);
		}
	}, [menuOptions.length, selectedMenuIndex, setSelectedMenuIndex]);

	return (
		<div className="space-y-2">
			{/* Search input */}
			<input
				ref={inputRef}
				type="text"
				value={searchQuery}
				onChange={(e) => setSearchQuery(e.target.value)}
				onKeyDown={(e) => {
					// Prevent up/down from moving cursor, let them control the list
					if (e.key === "ArrowUp" || e.key === "ArrowDown") {
						e.preventDefault();
					}
					// Enter should trigger selected option
					if (e.key === "Enter" && menuOptions[selectedMenuIndex]) {
						e.preventDefault();
						menuOptions[selectedMenuIndex].action();
					}
				}}
				placeholder="Type a command..."
				className={cn(
					"w-full h-9 px-3 py-2 text-sm",
					"font-mono",
					"bg-background border rounded-md",
					"transition-all duration-200",
					"placeholder:text-muted-foreground/60",
					"border-border hover:border-primary/50 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
				)}
				autoComplete="off"
				autoFocus
			/>

			{menuOptions.map((option, index) => (
				<div
					key={option.id}
					className={cn(
						"p-3 rounded cursor-pointer transition-all duration-150",
						index === selectedMenuIndex
							? "bg-primary text-primary-foreground"
							: "bg-muted/30 hover:bg-muted/60",
					)}
					onClick={() => {
						setSelectedMenuIndex(index);
						option.action();
					}}
					onMouseEnter={() => setSelectedMenuIndex(index)}
				>
					<div className="flex items-center justify-between">
						<div className="text-sm font-medium truncate">{option.label}</div>
						{option.hotkey && <KeyboardShortcut keyString={option.hotkey} />}
					</div>
				</div>
			))}

			<div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/30">
				<div className="flex items-center space-x-3">
					<span>↑↓ Navigate</span>
					<span>↵ Select</span>
				</div>
				<span>ESC Close</span>
			</div>
		</div>
	);
}

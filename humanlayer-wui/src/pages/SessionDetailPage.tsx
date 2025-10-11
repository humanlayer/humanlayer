import { useStore } from "@/AppStore";
import SessionDetail from "@/components/internal/SessionDetail";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

export function SessionDetailPage() {
	const { sessionId } = useParams<{ sessionId: string }>();
	const navigate = useNavigate();

	const activeSessionDetail = useStore((state) => state.activeSessionDetail);
	const fetchActiveSessionDetail = useStore(
		(state) => state.fetchActiveSessionDetail,
	);
	const clearActiveSessionDetail = useStore(
		(state) => state.clearActiveSessionDetail,
	);
	// Get the session from store if available for most up-to-date state (moved before early returns)
	const sessionFromStore = useStore((state) =>
		state.sessions.find((s) => s.id === sessionId),
	);

	useEffect(() => {
		if (sessionId) {
			fetchActiveSessionDetail(sessionId);
		}

		return () => {
			clearActiveSessionDetail();
		};
	}, [sessionId, fetchActiveSessionDetail, clearActiveSessionDetail]);

	const handleClose = () => {
		navigate("/");
	};

	// Show loading state only if we don't have a session at all
	if (!activeSessionDetail && !sessionId) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-center">
					<h2 className="text-lg font-semibold mb-2">No session selected</h2>
				</div>
			</div>
		);
	}

	// Show error state only if we have an error and no session data
	if (activeSessionDetail?.error && !activeSessionDetail?.session?.id) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-center">
					<h2 className="text-lg font-semibold mb-2">Session not found</h2>
					<p className="text-muted-foreground mb-4">
						{activeSessionDetail.error}
					</p>
					<Button
						onClick={handleClose}
						className="text-primary hover:underline"
					>
						← Back to Sessions
					</Button>
				</div>
			</div>
		);
	}

	// Render SessionDetail even during loading so it can show its skeleton UI
	// Pass a minimal session object if still loading

	const session = activeSessionDetail?.session?.id
		? activeSessionDetail.session
		: sessionFromStore
			? { ...sessionFromStore, fromStore: true }
			: {
					id: sessionId || "",
					runId: "",
					query: "",
					status: "unknown" as any,
					model: "",
					createdAt: new Date(),
					lastActivityAt: new Date(),
					summary: "",
					autoAcceptEdits: false,
					dangerouslySkipPermissions: false,
					dangerouslySkipPermissionsExpiresAt: undefined,
				};

	return (
		<div className="h-full">
			<SessionDetail session={session} onClose={handleClose} />
		</div>
	);
}

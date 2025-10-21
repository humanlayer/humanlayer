export const TOAST_IDS = {
  // Single operations
  archiveUndo: (sessionId: string) => `archive_undo:${sessionId}`,
  unarchiveUndo: (sessionId: string) => `unarchive_undo:${sessionId}`,
  draftDeleteUndo: (draftId: string) => `draft_delete_undo:${draftId}`,

  // Bulk operations
  bulkArchiveUndo: (timestamp: number) => `bulk_archive_undo:${timestamp}`,
  bulkUnarchiveUndo: (timestamp: number) => `bulk_unarchive_undo:${timestamp}`,
  bulkDraftDeleteUndo: (timestamp: number) => `bulk_draft_delete_undo:${timestamp}`,

  // Other patterns
  approvalRequired: (approvalId: string) => `approval_required:${approvalId}`,
} as const

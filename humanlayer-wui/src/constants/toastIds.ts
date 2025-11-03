export const TOAST_IDS = {
  // Single operations - include timestamp to ensure uniqueness for repeated operations
  archiveUndo: (sessionId: string) => `archive_undo:${sessionId}:${Date.now()}`,
  unarchiveUndo: (sessionId: string) => `unarchive_undo:${sessionId}:${Date.now()}`,
  draftDeleteUndo: (draftId: string) => `draft_delete_undo:${draftId}:${Date.now()}`,

  // Bulk operations
  bulkArchiveUndo: (timestamp: number) => `bulk_archive_undo:${timestamp}`,
  bulkUnarchiveUndo: (timestamp: number) => `bulk_unarchive_undo:${timestamp}`,
  bulkDraftDeleteUndo: (timestamp: number) => `bulk_draft_delete_undo:${timestamp}`,

  // Other patterns
  approvalRequired: (approvalId: string) => `approval_required:${approvalId}`,
} as const

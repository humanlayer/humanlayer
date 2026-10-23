export const ticketApplyPatchPath =
	'/Users/stet/src/ambral/ambral-auto/.humanlayer/tasks/ambrl-421-feature-make-customer_action-link-visible-to-customer_action/03-design-discussion-customer-action-links.md'

export const ticketAddFrontmatterPatch = `*** Begin Patch
*** Add File: ${ticketApplyPatchPath}
+---
+task: ambrl-421-feature-make-customer_action-link-visible-to-customer_action
+type: design-discussion
+repo: ambral-auto
+branch: master
+sha: 2415f86c7e28180d13818ad37c73f73cddc31fbc
+---
+
+# Customer Action Links
+
+### Summary of change request
+
+Make customer_action links visible to customer_action records and document the agent-facing link behavior.
+
+### Current State
+
+- Signals created by \`notify_user\`, \`notify_user_with_options\`, and \`notify_user_replacing\` persist the originating customer action ID when the tool closure has one.
+
+### Design Questions
+
+- Should agent links use absolute URLs or relative dashboard paths?
+*** End Patch`

export const ticketUpdateManyHunksPatch = `*** Begin Patch
*** Update File: ${ticketApplyPatchPath}
@@
-- Signals created by \`notify_user\`, \`notify_user_with_options\`, and \`notify_user_replacing\` persist the originating customer action ID when the tool closure has one.
+- Signals created by \`notify_user\`, \`notify_user_with_options\`, and \`notify_user_replacing\` persist the originating customer action ID in \`customer_action_id\` when the tool closure has one.
@@
-#### Nullable source foreign keys on signals
+#### Nullable signal foreign keys
@@
-The source foreign keys on signals should remain required.
+The signal foreign keys should be nullable so backfilled and manually created rows can exist without a source customer action.
@@
-#### Link target ownership
+#### Customer action link ownership
@@
-The agent should infer the link from the response editor.
+The agent should read the link from the associated \`customer_action_id\` when available.
@@
-#### Customer action field name
+#### customer_action_id field name
@@
-The exact signal column name is still undecided.
+The signal column should be named \`customer_action_id\`.
@@
-#### Agent link visibility
+#### Agent-visible customer action links
@@
-Links are only visible in internal dashboard state.
+Links should be visible to the agent through customer action metadata.
@@
-#### Link persistence
+#### Customer action link persistence
@@
-Links are reconstructed at render time.
+Links should be persisted with the signal payload when the customer action exists.
@@
-#### API response shape
+#### Agent link format
@@
-The API can return any dashboard URL.
+The API should return a relative dashboard path for the linked customer action.
@@
-### Unresolved Design Questions
+### Resolved Design Questions
@@
-- None yet. The main unresolved choices are absolute-vs-relative link format and exact signal column naming.
+#### Agent link format
+
+Use a relative dashboard path so the cloud and local UI can resolve the link in their own host context.
@@
-### Next Steps
+### Implementation Notes
@@
-- Decide the column name.
+- Persist \`customer_action_id\` on signals and expose the relative link in customer action metadata.
*** End Patch`

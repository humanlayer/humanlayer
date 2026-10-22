import z from 'zod/v4'

/**
 * Canonical client identifiers for any flow that leaves the app, bounces through a
 * third party, and has to decide where to send the user back to.
 *
 * - `ui`     — riptide-ui served in a browser at `APP_ORIGIN`
 * - `cloud`  — riptide-cloud
 * - `native` — the Tauri desktop app
 */
export const RIPTIDE_CLIENTS = ['ui', 'cloud', 'native'] as const
export const RiptideClientSchema = z.enum(RIPTIDE_CLIENTS)
export type RiptideClient = z.infer<typeof RiptideClientSchema>

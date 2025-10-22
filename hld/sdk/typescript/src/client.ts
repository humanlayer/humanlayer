import {
    Configuration,
    SessionsApi,
    ApprovalsApi,
    SystemApi,
    SettingsApi,
    FilesApi,
    AgentsApi,
    CreateSessionRequest,
    Session,
    SessionsResponse,
    Approval,
    CreateSessionResponse,
    CreateSessionResponseData,
    EventFromJSON,
    RecentPath,
    ListSessionsRequest,
    UserSettingsResponse,
    UpdateUserSettingsRequest,
    ConfigResponse,
    UpdateConfigRequest,
    FuzzySearchFilesRequest,
    FuzzySearchFilesResponse,
    DiscoverAgents200Response
} from './generated';
import { createErrorInterceptor } from './middleware';

export interface HLDClientOptions {
    baseUrl?: string;
    port?: number;
    headers?: Record<string, string>;
    // New option for error handling
    onFetchError?: (error: Error, context: { url: string; method?: string }) => void;
}

export interface SSEEventHandlers {
    onMessage?: (event: any) => void;
    onError?: (error: Error) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
}

// Unified interface for both browser EventSource and polyfill
interface EventSourceLike {
    close(): void;
    readyState: number;
}

export class HLDClient {
    private sessionsApi: SessionsApi;
    private approvalsApi: ApprovalsApi;
    private settingsApi: SettingsApi;
    private filesApi: FilesApi;
    private agentsApi: AgentsApi;
    private baseUrl: string;
    private headers?: Record<string, string>;
    private sseConnections: Map<string, EventSourceLike> = new Map();

    constructor(options: HLDClientOptions = {}) {
        this.baseUrl = options.baseUrl || `http://127.0.0.1:${options.port || 7777}/api/v1`;
        this.headers = options.headers;

        const config = new Configuration({
            basePath: this.baseUrl,
            headers: this.headers,
            // Add error interceptor middleware
            middleware: [
                createErrorInterceptor({
                    onError: (error, context) => {
                        // Call custom handler if provided
                        if (options.onFetchError) {
                            options.onFetchError(error, {
                                url: context.url,
                                method: context.init?.method,
                            });
                        }
                    },
                    logErrors: true,
                })
            ]
        });

        this.sessionsApi = new SessionsApi(config);
        this.approvalsApi = new ApprovalsApi(config);
        this.settingsApi = new SettingsApi(config);
        this.filesApi = new FilesApi(config);
        this.agentsApi = new AgentsApi(config);
    }

    // Session Management
    async createSession(request: CreateSessionRequest): Promise<CreateSessionResponseData> {
        const response = await this.sessionsApi.createSession({ createSessionRequest: request });
        return response.data;
    }

    async listSessions(params?: ListSessionsRequest): Promise<Session[]> {
        const response = await this.sessionsApi.listSessions(params);
        return response.data;
    }

    async listSessionsWithCounts(params?: ListSessionsRequest): Promise<SessionsResponse> {
        return await this.sessionsApi.listSessions(params);
    }

    async getSession(id: string): Promise<Session> {
        const response = await this.sessionsApi.getSession({ id });
        return response.data;
    }

    // Approval Management
    async listApprovals(sessionId?: string): Promise<Approval[]> {
        const response = await this.approvalsApi.listApprovals({ sessionId });
        return response.data;
    }

    async decideApproval(id: string, decision: 'approve' | 'deny', comment?: string): Promise<void> {
        await this.approvalsApi.decideApproval({
            id,
            decideApprovalRequest: { decision, comment }
        });
    }

    // Session continuation
    async continueSession(id: string, query: string): Promise<{ sessionId: string; runId: string }> {
        const response = await this.sessionsApi.continueSession({
            id,
            continueSessionRequest: { query }
        });
        return response.data;
    }

    // Session interruption
    async interruptSession(id: string): Promise<void> {
        await this.sessionsApi.interruptSession({ id });
    }

    // Launch draft session
    async launchDraftSession(id: string, prompt: string): Promise<void> {
        await this.sessionsApi.launchDraftSession({
            id,
            launchDraftSessionRequest: { prompt }
        });
    }

    // Delete draft session
    async deleteDraftSession(id: string): Promise<void> {
        await this.sessionsApi.deleteDraftSession({ id });
    }

    // Session archival
    async archiveSessions(sessionIds: string[], archived: boolean = true): Promise<{ archived: string[] }> {
        const response = await this.sessionsApi.bulkArchiveSessions({
            bulkArchiveRequest: { sessionIds, archived }
        });
        // The response contains 'success' and optional 'failedSessions'
        // For the test plan, we'll return a simplified response
        return { archived: sessionIds.filter(id => !response.data.failedSessions?.includes(id)) };
    }

    // Bulk restore drafts
    async bulkRestoreDrafts(params: { session_ids: string[] }): Promise<{ success: boolean; failed_sessions?: string[] }> {
        const response = await this.sessionsApi.bulkRestoreDrafts({
            bulkRestoreDraftsRequest: { sessionIds: params.session_ids }
        });
        return {
            success: response.data.success,
            failed_sessions: response.data.failedSessions
        };
    }

    // Update session settings
    async updateSession(id: string, updates: {
        auto_accept_edits?: boolean,
        title?: string,
        dangerouslySkipPermissions?: boolean,
        dangerouslySkipPermissionsTimeoutMs?: number,
        model?: string,
        modelId?: string,
        proxyEnabled?: boolean,
        proxyBaseUrl?: string,
        proxyModelOverride?: string,
        proxyApiKey?: string,
        archived?: boolean,
        additionalDirectories?: string[],
        working_dir?: string,
        editorState?: string
    }): Promise<void> {
        // Build request with only defined fields to avoid sending undefined values
        const updateSessionRequest: any = {};
        if (updates.auto_accept_edits !== undefined) {
            updateSessionRequest.autoAcceptEdits = updates.auto_accept_edits;
        }
        if (updates.title !== undefined) {
            updateSessionRequest.title = updates.title;
        }
        if (updates.dangerouslySkipPermissions !== undefined) {
            updateSessionRequest.dangerouslySkipPermissions = updates.dangerouslySkipPermissions;
        }
        if (updates.dangerouslySkipPermissionsTimeoutMs !== undefined) {
            updateSessionRequest.dangerouslySkipPermissionsTimeoutMs = updates.dangerouslySkipPermissionsTimeoutMs;
        }
        if (updates.model !== undefined) {
            updateSessionRequest.model = updates.model;
        }
        if (updates.modelId !== undefined) {
            updateSessionRequest.modelId = updates.modelId;
        }
        if (updates.proxyEnabled !== undefined) {
            updateSessionRequest.proxyEnabled = updates.proxyEnabled;
        }
        if (updates.proxyBaseUrl !== undefined) {
            updateSessionRequest.proxyBaseUrl = updates.proxyBaseUrl;
        }
        if (updates.proxyModelOverride !== undefined) {
            updateSessionRequest.proxyModelOverride = updates.proxyModelOverride;
        }
        if (updates.proxyApiKey !== undefined) {
            updateSessionRequest.proxyApiKey = updates.proxyApiKey;
        }
        if (updates.archived !== undefined) {
            updateSessionRequest.archived = updates.archived;
        }
        if (updates.additionalDirectories !== undefined) {
            updateSessionRequest.additionalDirectories = updates.additionalDirectories;
        }
        if (updates.working_dir !== undefined) {
            updateSessionRequest.workingDir = updates.working_dir;
        }
        if (updates.editorState !== undefined) {
            updateSessionRequest.editorState = updates.editorState;
        }

        await this.sessionsApi.updateSession({
            id,
            updateSessionRequest
        });
    }

    // Get session messages
    async getSessionMessages(id: string, initOverrides?: RequestInit): Promise<any[]> {
        const response = await this.sessionsApi.getSessionMessages({ id }, initOverrides);
        return response.data;
    }

    // Get session snapshots
    async getSessionSnapshots(id: string): Promise<any[]> {
        const response = await this.sessionsApi.getSessionSnapshots({ id });
        return response.data;
    }

    // Get slash commands
    async getSlashCommands(params: { workingDir: string; query?: string }): Promise<{ data: Array<{ name: string }> }> {
        const response = await this.sessionsApi.getSlashCommands(params);
        return response;
    }

    // Search sessions
    async searchSessions(params: { query?: string; limit?: number }): Promise<{ data: Session[] }> {
        const response = await this.sessionsApi.searchSessions(params);
        return response;
    }

    // Get recent paths
    async getRecentPaths(): Promise<RecentPath[]> {
        const response = await this.sessionsApi.getRecentPaths({});
        // Extract the data array from the response wrapper
        return response.data || [];
    }

    // Get approval by ID
    async getApproval(id: string): Promise<Approval> {
        const response = await this.approvalsApi.getApproval({ id });
        return response.data;
    }

    // Health check
    async health(): Promise<{ status: string; version: string }> {
        const systemApi = new SystemApi(new Configuration({
            basePath: this.baseUrl,
            headers: this.headers
        }));
        const response = await systemApi.getHealth();
        return response;
    }

    // User Settings
    async getUserSettings(): Promise<UserSettingsResponse> {
        return await this.settingsApi.getUserSettings();
    }

    async updateUserSettings(request: UpdateUserSettingsRequest): Promise<UserSettingsResponse> {
        return await this.settingsApi.updateUserSettings({ updateUserSettingsRequest: request });
    }

    // Configuration
    async getConfig(): Promise<ConfigResponse> {
        return await this.settingsApi.getConfig();
    }

    async updateConfig(request: UpdateConfigRequest): Promise<ConfigResponse> {
        return await this.settingsApi.updateConfig({ updateConfigRequest: request });
    }

    // Files
    async fuzzySearchFiles(params: {
        query: string;
        paths: string[];
        limit?: number;
        filesOnly?: boolean;
        respectGitignore?: boolean;
    }): Promise<FuzzySearchFilesResponse> {
        const response = await this.filesApi.fuzzySearchFiles({
            fuzzySearchFilesRequest: params
        });
        return response;
    }

    // Agents
    async discoverAgents(params: {
        discoverAgentsRequest: { workingDir: string }
    }): Promise<DiscoverAgents200Response> {
        const response = await this.agentsApi.discoverAgents(params);
        return response;
    }

    // Server-Sent Events using eventsource polyfill
    async subscribeToEvents(
        params: {
            eventTypes?: string[];
            sessionId?: string;
            runId?: string;
        },
        handlers: SSEEventHandlers
    ): Promise<() => void> {
        const subscriptionId = Math.random().toString(36);

        const queryParams = new URLSearchParams();
        if (params.eventTypes) {
            params.eventTypes.forEach(type => queryParams.append('eventTypes', type));
        }
        if (params.sessionId) queryParams.append('sessionId', params.sessionId);
        if (params.runId) queryParams.append('runId', params.runId);

        const url = `${this.baseUrl}/stream/events${queryParams.toString() ? '?' + queryParams : ''}`;

        // Create EventSource with polyfill support
        let eventSource: EventSourceLike & {
            onopen?: ((this: any, ev: Event) => any) | null;
            onmessage?: ((this: any, ev: MessageEvent) => any) | null;
            onerror?: ((this: any, ev: Event) => any) | null;
        };

        if (typeof globalThis !== 'undefined' && globalThis.EventSource) {
            // Browser environment - EventSource doesn't support headers
            eventSource = new globalThis.EventSource(url);
            if (this.headers) {
                console.warn('Headers are not supported in browser EventSource API');
            }
        } else {
            // Node.js environment with polyfill - supports headers
            // Dynamic import to avoid bundling in browser
            const { EventSource: EventSourcePolyfill } = require('eventsource');
            eventSource = new EventSourcePolyfill(url, {
                headers: this.headers,
                withCredentials: false
            });
        }

        this.sseConnections.set(subscriptionId, eventSource);

        // Set up event handlers
        eventSource.onopen = () => {
            handlers.onConnect?.();
        };

        eventSource.onmessage = (event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                // Use the generated converter to transform the event
                const typedEvent = EventFromJSON(data);
                handlers.onMessage?.(typedEvent);
            } catch (e) {
                handlers.onError?.(new Error(`Failed to parse event: ${e}`));
            }
        };

        eventSource.onerror = (event: Event) => {
            // EventSource will automatically reconnect on non-fatal errors
            // Check if the connection is closed (readyState === 2)
            if (eventSource.readyState === 2) { // CLOSED state
                handlers.onDisconnect?.();
                handlers.onError?.(new Error('Connection closed'));

                // Clean up the connection
                this.sseConnections.delete(subscriptionId);
            } else {
                // Connection error but will retry
                handlers.onError?.(new Error('Connection error, retrying...'));
            }
        };

        // Return unsubscribe function
        return () => {
            eventSource.close();
            this.sseConnections.delete(subscriptionId);
            handlers.onDisconnect?.();
        };
    }

    // Clean up all SSE connections
    disconnect(): void {
        this.sseConnections.forEach(eventSource => eventSource.close());
        this.sseConnections.clear();
    }
}

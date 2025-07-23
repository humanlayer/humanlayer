import { fetchEventSource } from '@microsoft/fetch-event-source';
import { 
    Configuration,
    SessionsApi,
    ApprovalsApi,
    CreateSessionRequest,
    CreateSessionResponseData,
    Session,
    Approval
} from './generated';

export interface HLDClientOptions {
    baseUrl?: string;
    port?: number;
    headers?: Record<string, string>;
}

export interface SSEEventHandlers {
    onMessage?: (event: any) => void;
    onError?: (error: Error) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
}

class RetriableError extends Error {}
class FatalError extends Error {}

export class HLDClient {
    private sessionsApi: SessionsApi;
    private approvalsApi: ApprovalsApi;
    private baseUrl: string;
    private headers?: Record<string, string>;
    private sseControllers: Map<string, AbortController> = new Map();

    constructor(options: HLDClientOptions = {}) {
        this.baseUrl = options.baseUrl || `http://127.0.0.1:${options.port || 7777}/api/v1`;
        this.headers = options.headers;
        
        const config = new Configuration({
            basePath: this.baseUrl,
            headers: this.headers
        });
        
        this.sessionsApi = new SessionsApi(config);
        this.approvalsApi = new ApprovalsApi(config);
    }

    // Session Management
    async createSession(request: CreateSessionRequest): Promise<CreateSessionResponseData> {
        const response = await this.sessionsApi.createSession({ createSessionRequest: request });
        return response.data;
    }

    async listSessions(params?: { leafOnly?: boolean; includeArchived?: boolean }): Promise<Session[]> {
        const response = await this.sessionsApi.listSessions(params);
        return response.data;
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

    // Server-Sent Events using @microsoft/fetch-event-source
    async subscribeToEvents(
        params: {
            eventTypes?: string[];
            sessionId?: string;
            runId?: string;
        },
        handlers: SSEEventHandlers
    ): Promise<() => void> {
        const controller = new AbortController();
        const subscriptionId = Math.random().toString(36);
        this.sseControllers.set(subscriptionId, controller);

        const queryParams = new URLSearchParams();
        if (params.eventTypes) {
            params.eventTypes.forEach(type => queryParams.append('eventTypes', type));
        }
        if (params.sessionId) queryParams.append('sessionId', params.sessionId);
        if (params.runId) queryParams.append('runId', params.runId);

        const url = `${this.baseUrl}/stream/events${queryParams.toString() ? '?' + queryParams : ''}`;

        // Start SSE connection with @microsoft/fetch-event-source
        fetchEventSource(url, {
            method: 'GET',
            headers: this.headers,
            signal: controller.signal,
            
            async onopen(response) {
                if (response.ok && response.headers.get('content-type') === 'text/event-stream') {
                    handlers.onConnect?.();
                    return;
                }
                
                if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                    throw new FatalError(`Client error: ${response.status}`);
                }
                
                throw new RetriableError(`Server error: ${response.status}`);
            },
            
            onmessage(event) {
                try {
                    const data = JSON.parse(event.data);
                    handlers.onMessage?.(data);
                } catch (e) {
                    handlers.onError?.(new Error(`Failed to parse event: ${e}`));
                }
            },
            
            onclose() {
                handlers.onDisconnect?.();
                // Automatically reconnect
                throw new RetriableError('Connection closed');
            },
            
            onerror(err) {
                if (err instanceof FatalError) {
                    handlers.onError?.(err);
                    throw err; // Stop retry
                }
                
                if (err instanceof RetriableError) {
                    // Return retry delay in milliseconds
                    return 1000;
                }
                
                handlers.onError?.(err);
                throw err;
            }
        }).catch(err => {
            // Final error after all retries
            if (!(err instanceof Error && err.message === 'AbortError')) {
                handlers.onError?.(err);
            }
        });

        // Return unsubscribe function
        return () => {
            controller.abort();
            this.sseControllers.delete(subscriptionId);
        };
    }

    // Clean up all SSE connections
    disconnect(): void {
        this.sseControllers.forEach(controller => controller.abort());
        this.sseControllers.clear();
    }
}
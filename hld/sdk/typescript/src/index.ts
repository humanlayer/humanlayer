export { HLDClient, HLDClientOptions, SSEEventHandlers } from './client';
export * from './generated';

// Export middleware utilities
export { createErrorInterceptor } from './middleware';
export type { ErrorInterceptorOptions } from './middleware';

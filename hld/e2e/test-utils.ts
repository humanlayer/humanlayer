import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as net from 'net';
import * as os from 'os';

export interface TestEnvironment {
    testDir: string;
    socketPath: string;
    httpPort: number;
    daemon: ChildProcess | null;
    cleanup: () => Promise<void>;
}

// Get a free port by binding to 0
export async function getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as net.AddressInfo).port;
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

// Create test environment with isolated directories
export async function createTestEnvironment(): Promise<TestEnvironment> {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const testDir = path.join(os.tmpdir(), `hld-e2e-${timestamp}-${random}`);
    
    // Create directory structure
    await fs.mkdir(path.join(testDir, 'workspace'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'data'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'logs'), { recursive: true });
    
    // Create test file
    await fs.writeFile(
        path.join(testDir, 'workspace', 'example.txt'),
        'The sun sets slowly\nColors paint the evening sky\nDay becomes the night\n'
    );
    
    // Short socket path for macOS
    const socketPath = `/tmp/hld-${process.pid}-e2e.sock`;
    const httpPort = await getFreePort();
    
    const env: TestEnvironment = {
        testDir,
        socketPath,
        httpPort,
        daemon: null,
        cleanup: async () => {
            // Stop daemon if running
            if (env.daemon && !env.daemon.killed) {
                env.daemon.kill('SIGTERM');
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (!env.daemon.killed) {
                    env.daemon.kill('SIGKILL');
                }
            }
            
            // Remove socket
            try {
                await fs.unlink(socketPath);
            } catch {}
            
            // Remove test directory unless debugging
            if (!process.env.KEEP_TEST_ARTIFACTS) {
                await fs.rm(testDir, { recursive: true, force: true });
            }
        }
    };
    
    return env;
}

// Spawn daemon with test configuration
export async function spawnDaemon(env: TestEnvironment): Promise<void> {
    const daemonPath = path.join(__dirname, '..', 'hld');
    
    env.daemon = spawn(daemonPath, [], {
        env: {
            ...process.env,
            HUMANLAYER_DATABASE_PATH: path.join(env.testDir, 'data', 'daemon.db'),
            HUMANLAYER_DAEMON_SOCKET_PATH: env.socketPath,
            HUMANLAYER_DAEMON_HTTP_PORT: env.httpPort.toString(),
            HUMANLAYER_DAEMON_HTTP_HOST: '127.0.0.1',
            HUMANLAYER_DEBUG: 'true',
            HUMANLAYER_MCP_DEBUG: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    
    // Log daemon output
    const logFile = await fs.open(path.join(env.testDir, 'logs', 'daemon.log'), 'w');
    env.daemon.stdout?.pipe(logFile.createWriteStream());
    env.daemon.stderr?.pipe(logFile.createWriteStream());
    
    // Wait for daemon to be ready
    await waitForDaemon(env.httpPort);
}

// Wait for daemon to start
async function waitForDaemon(port: number, timeout: number = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
            if (response.ok) return;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Daemon failed to start within timeout');
}

// Event collector for SSE
export class EventCollector {
    private events: any[] = [];
    private waiters: Map<string, { resolve: (event: any) => void; type: string; predicate?: (event: any) => boolean }> = new Map();
    
    addEvent(event: any) {
        this.events.push(event);
        // Check waiters
        for (const [id, waiter] of this.waiters) {
            if (event.type === waiter.type && (!waiter.predicate || waiter.predicate(event))) {
                waiter.resolve(event);
                this.waiters.delete(id);
            }
        }
    }
    
    async waitForEvent(
        type: string,
        predicate?: (event: any) => boolean,
        timeout: number = 30000
    ): Promise<any> {
        // Check existing events
        const existing = this.events.find(e => 
            e.type === type && (!predicate || predicate(e))
        );
        if (existing) return existing;
        
        // Wait for future event
        return new Promise((resolve, reject) => {
            const id = `${type}:${Date.now()}:${Math.random()}`;
            this.waiters.set(id, { resolve, type, predicate });
            
            setTimeout(() => {
                this.waiters.delete(id);
                reject(new Error(`Timeout waiting for ${type} event`));
            }, timeout);
        });
    }
    
    getEvents(): any[] {
        return [...this.events];
    }
    
    clear() {
        this.events = [];
    }
}

// Assertion helpers
export function assertEvent(event: any, expected: Partial<any>) {
    for (const [key, value] of Object.entries(expected)) {
        if (key === 'data' && typeof value === 'object') {
            // Deep check data properties
            for (const [dataKey, dataValue] of Object.entries(value)) {
                if (event.data[dataKey] !== dataValue) {
                    throw new Error(
                        `Event data.${dataKey} mismatch: expected ${dataValue}, got ${event.data[dataKey]}`
                    );
                }
            }
        } else if (event[key] !== value) {
            throw new Error(`Event ${key} mismatch: expected ${value}, got ${event[key]}`);
        }
    }
}

// ANSI color codes
export const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
};

// Check if colors should be disabled
const noColor = process.env.NO_COLOR || process.env.CI;

export function color(text: string, colorCode: string): string {
    if (noColor) return text;
    return `${colorCode}${text}${colors.reset}`;
}

// Logging levels
export enum LogLevel {
    SILENT = 0,
    NORMAL = 1,
    VERBOSE = 2,
    DEBUG = 3
}

let currentLogLevel = LogLevel.NORMAL;

export function setLogLevel(level: LogLevel) {
    currentLogLevel = level;
}

export function log(message: string, data?: any, level: LogLevel = LogLevel.VERBOSE) {
    if (currentLogLevel < level) return;
    
    if (currentLogLevel >= LogLevel.VERBOSE) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ${message}`);
    } else {
        console.log(message);
    }
    
    if (data && currentLogLevel >= LogLevel.DEBUG) {
        console.log(JSON.stringify(data, null, 2));
    }
}

export function logSuccess(message: string) {
    console.log(color('✓', colors.green) + ' ' + message);
}

export function logError(message: string) {
    console.log(color('✗', colors.red) + ' ' + message);
}

export function logWarning(message: string) {
    console.log(color('⚠', colors.yellow) + ' ' + message);
}

export function logPhase(phase: string) {
    if (currentLogLevel >= LogLevel.NORMAL) {
        console.log('\n' + color(`━━━ ${phase} ━━━`, colors.blue));
    }
}

export function logProgress(current: number, total: number, description: string) {
    if (currentLogLevel >= LogLevel.NORMAL) {
        const progress = `[${current}/${total}]`;
        console.log(color(progress, colors.dim) + ' ' + description);
    }
}
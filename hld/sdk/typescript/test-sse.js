#!/usr/bin/env node

// Simple test script to verify SSE functionality
// Run with: node test-sse.js

const { HLDClient } = require('./dist/index.js');

async function testSSE() {
    console.log('Testing HLD SDK SSE functionality...\n');
    
    const client = new HLDClient({
        port: 7777  // Default HLD REST API port
    });
    
    console.log('Subscribing to all events...');
    
    try {
        const unsubscribe = await client.subscribeToEvents(
            {
                // No filters - get all events
            },
            {
                onConnect: () => {
                    console.log('✅ Connected to SSE stream');
                },
                onMessage: (event) => {
                    console.log('📨 Event received:', JSON.stringify(event, null, 2));
                },
                onError: (error) => {
                    console.error('❌ SSE Error:', error.message);
                },
                onDisconnect: () => {
                    console.log('🔌 Disconnected from SSE stream');
                }
            }
        );
        
        console.log('\nListening for events... Press Ctrl+C to stop\n');
        
        // Keep the process running
        process.on('SIGINT', () => {
            console.log('\nStopping SSE test...');
            unsubscribe();
            client.disconnect();
            process.exit(0);
        });
        
    } catch (error) {
        console.error('Failed to connect:', error);
        process.exit(1);
    }
}

// Note: Make sure the HLD daemon is running with REST API enabled:
// HUMANLAYER_DAEMON_HTTP_PORT=7777 hld
console.log('Note: Make sure HLD daemon is running with REST API enabled:');
console.log('HUMANLAYER_DAEMON_HTTP_PORT=7777 hld\n');

testSSE();
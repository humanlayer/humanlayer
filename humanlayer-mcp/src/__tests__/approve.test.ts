import { describe, it, expect } from '@jest/globals';
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Get the path to the claude binary and node from environment or use defaults
const CLAUDE_PATH = process.env.CLAUDE_PATH || "/Users/dex/.bun/bin/claude";

const command = ({toolName = "approve"}: {toolName: string}) => `
${CLAUDE_PATH} --mcp-config ./mcp-config.json \
    --permission-prompt-tool mcp__humanlayer_local__${toolName} \
    -p "reticulate splines please"
`;

interface TestCase {
    name: string;
    payload: any;
    expectedOutput?: any;
}

const cases: TestCase[] = [
    {
        name: "approve",
        payload: {
            content: [
                {
                    type: "text",
                    text: "approved"
                }
            ],
        },
    }, 
    {
        name: "reject",
        payload: {
            content: [
                {
                    type: "text",
                    text: "rejected"
                }
            ],
        },
    },
    {
        name: "reject 2",
        payload: {
            content: [
                {
                    type: "text",
                    text: "no"
                }
            ],
        },
    },
];

describe("approve command", () => {
    cases.forEach(({ name, payload, expectedOutput }) => {
        it(name, async () => {
            try {
                const { stdout } = await execAsync(command({ toolName: "approve" }), {
                    env: {
                        ...process.env,
                        PATH: `${process.env.PATH}:/usr/local/bin`, // Ensure node is in PATH
                        APPROVE_PAYLOAD: JSON.stringify(payload)
                    }
                });
                
                if (expectedOutput) {
                    expect(stdout.trim()).toEqual(expectedOutput);
                }
            } catch (error) {
                // If the command fails, the error will contain stderr
                const err = error as { stderr: string };
                throw new Error(`Command failed: ${err.stderr}`);
            }
        }, 60000);
    });
});

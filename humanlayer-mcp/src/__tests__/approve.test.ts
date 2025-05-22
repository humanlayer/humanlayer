import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const CLAUDE_PATH = process.env.CLAUDE_PATH || "/Users/dex/.bun/bin/claude";

const command = ({toolName = "approve"}: {toolName: string}) => `
${CLAUDE_PATH} --mcp-config ./mcp-config.json \
    --permission-prompt-tool mcp__humanlayer_local__${toolName} \
    -p "reticulate splines please"
`

type Case = {
    name: string;
    payload: any;
    expected?: any;
}

const cases: Case[] = [
    {
        name: "approve",
        payload: {
            result: true,
            message: "approved",
        },
        expected: "ehhhh",
    }
]

describe("approve", () => {
    cases.forEach(({name, payload, expected}) => {
        it(`${name}`, async () => {
            const { stdout } = await execAsync(command({toolName: "approve"}), { env: { APPROVE_PAYLOAD: JSON.stringify(payload) } });
            if (expected) {
                expect(stdout.trim()).toEqual(expected);
            }
        });
    });
});

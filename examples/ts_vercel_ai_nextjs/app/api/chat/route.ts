import { openai } from "@ai-sdk/openai";
import { Message as AIMessage, streamText } from "ai";
import { z } from "zod";
import { humanlayer } from "humanlayer-vercel-ai-sdk";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

const hl = humanlayer({
  verbose: true,
});

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai("gpt-4o"),
    messages,
    maxSteps: 10,
    tools: {
      // Functions that don't require approval
      fetch_active_orders: {
        description: "Fetch active orders using the user's email.",
        parameters: z.object({
          email: z.string().describe("The user's email address"),
        }),
        execute: async ({ email }: { email: string }) => {
          console.log(`[API] Fetching active orders for ${email}`);
          return [
            {
              order_id: "123",
              status: "active",
              amount: 100,
              created_at: "2021-01-01",
              updated_at: "2021-01-01",
            },
            {
              order_id: "456",
              status: "cancelled",
              amount: 200,
              created_at: "2021-01-01",
              updated_at: "2021-01-01",
            },
          ]; // Simulated active orders
        },
      },

      // Functions requiring approval
      reimburse_order: hl.requireApproval({
        reimburse_order: {
          description: "Process a refund with human approval",
          parameters: z.object({
            order_id: z.string().describe("The order ID to reimburse"),
            reason: z.string().describe("The reason for the reimbursement"),
          }),
          execute: async ({
            order_id,
            reason,
          }: {
            order_id: string;
            reason: string;
          }) => {
            console.log(
              `[API] Processing refund for order ${order_id} with reason: ${reason}`,
            );
            // Reimbursement logic would go here
            return "refund processed";
          },
        },
      }),
    },
    system:
      "You are a helpful assistant. If the user asks for anything that requires order information, you should use the fetch_active_orders tool first.",
  });

  return result.toDataStreamResponse();
}

import { tool, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { humanlayer } from "humanlayer-vercel-ai-sdk";
import { z } from "zod";

const hl = humanlayer({
  verbose: true,
});

const prompt = `multiply 2 and ?R?@)GSA

contact a human if you need help`;

const multiply = tool({
  parameters: z.object({
    a: z.number(),
    b: z.number(),
  }),
  execute: async (args) => {
    return args.a * args.b;
  },
});

const contactHuman = hl.humanAsTool();

const openai = createOpenAI({
  compatibility: "strict",
});

const main = async () => {
  const { text, steps } = await generateText({
    model: openai("gpt-4o-mini"),
    tools: {
      multiply,
      contactHuman,
    },
    maxSteps: 5,
    prompt: prompt,
  });
  console.log(text);
};

main()
  .then((result) => {
    console.log(result);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

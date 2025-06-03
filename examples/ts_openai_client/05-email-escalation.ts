import { FunctionCall, humanlayer } from "@humanlayer/sdk";
import chalk from "chalk";

// Validate required environment variables
const requiredEnvVars = [
  "HUMANLAYER_API_KEY",
  "HL_EXAMPLE_CONTACT_EMAIL",
  "HL_EXAMPLE_SECOND_CONTACT_EMAIL",
  "HL_EXAMPLE_THIRD_CONTACT_EMAIL",
];

for (const envVar of requiredEnvVars) {
  console.log(`Missing required environment variable: ${chalk.red(envVar)}`);
  process.exit(1);
}

const hl = humanlayer({ verbose: true, runId: "email-escalation" });

const demoEscalation = async () => {
  const call: FunctionCall = await hl.createFunctionCall({
    spec: {
      fn: "multiply",
      kwargs: { foo: "bar" },
      channel: {
        email: {
          experimental_subject_line: "FunctionCall Approval, a HumanLayer Test",
          address: process.env.HL_EXAMPLE_CONTACT_EMAIL,
        },
      },
    },
  });

  console.log(
    `First function call sent to ${chalk.green(process.env.HL_EXAMPLE_CONTACT_EMAIL)}. Waiting 5 more seconds and then escalating to ${chalk.yellow(process.env.HL_EXAMPLE_SECOND_CONTACT_EMAIL)}...\n`
  );

  // EXAMPLE - escalate immediately after 5 seconds
  // in reality, this would happen after some longer amount of time has passed
  await new Promise((resolve) => setTimeout(resolve, 1000 * 5));

  await hl.escalateEmailFunctionCall(call.call_id, {
    escalation_msg: "please take a look because it's been too long",
    additional_recipients: [
      {
        experimental_subject_line: "FunctionCall Approval, a HumanLayer Test (1st Escalation)",
        address: process.env.HL_EXAMPLE_SECOND_CONTACT_EMAIL,
        field: "to",
      },
    ],
  });

  console.log(
    `First escalation sent to ${chalk.yellow(process.env.HL_EXAMPLE_SECOND_CONTACT_EMAIL)}. Waiting 5 more seconds and then sending to ${chalk.red(process.env.HL_EXAMPLE_THIRD_CONTACT_EMAIL)}...\n`
  );

  // Wait another 5 seconds, then escalate to a different channel entirely
  await new Promise((resolve) => setTimeout(resolve, 1000 * 5));

  const second_escalation: FunctionCall = await hl.escalateEmailFunctionCall(
    call.call_id,
    {
      escalation_msg: "URGENT: Still no response - escalating to management",
      channel: {
        email: {
          experimental_subject_line: "FunctionCall Approval, a HumanLayer Test (2nd Escalation)",
          address: process.env.HL_EXAMPLE_THIRD_CONTACT_EMAIL,
        },
      },
    }
  );

  console.log(
    `Check your emails - escalated to different address: ${JSON.stringify(
      second_escalation,
      null,
      2
    )}`
  );
};

const main = async (): Promise<any> => {
  return await demoEscalation();
};

main()
  .then(console.log)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

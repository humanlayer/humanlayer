import { FunctionCall, humanlayer } from "humanlayer";

const hl = humanlayer({ verbose: true, runId: "email-escalation" });

const demoEscalation = async () => {
  const call: FunctionCall = await hl.createFunctionCall({
    spec: {
      fn: "multiply",
      kwargs: { foo: "bar" },
      channel: {
        email: {
          address:
            process.env.HL_EXAMPLE_CONTACT_EMAIL || "dexter@humanlayer.dev",
        },
      },
    },
  });

  // EXAMPLE - escalate immediately after 5 seconds
  // in reality, this would happen after some longer amount of time has passed
  await new Promise((resolve) => setTimeout(resolve, 1000 * 5));

  const escalated_call: FunctionCall = await hl.escalateEmailFunctionCall(
    call.call_id,
    {
      escalation_msg: "please take a look because it's been too long",
      additional_recipients: [
        {
          address:
            process.env.HL_EXAMPLE_SECOND_CONTACT_EMAIL || "dan@humanlayer.dev",
          field: "to",
        },
      ],
    },
  );

  console.log(`Check your email ${JSON.stringify(escalated_call, null, 2)}`);
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

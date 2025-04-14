import { EmailContactChannel, FunctionCall, humanlayer } from "humanlayer";

const hl = humanlayer({ verbose: true, runId: "email-multiple" });

const demoMultiple = async () => {
  const call: FunctionCall = await hl.createFunctionCall({
    spec: {
      fn: "multiply",
      kwargs: { foo: "bar" },
      channel: {
        email: {
          address:
            process.env.HL_EXAMPLE_CONTACT_EMAIL || "dexter@humanlayer.dev",
          additional_recipients: [
            {
              address:
                process.env.HL_EXAMPLE_SECOND_CONTACT_EMAIL || "sundeep@humanlayer.dev",
              field: "cc",
            },
          ],
        }, 
      },
    },
  });
};

const main = async (): Promise<any> => {
  return await demoMultiple();
};

main()
  .then(console.log)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

import { FunctionCall, humanlayer } from "humanlayer";

const hl = humanlayer({ verbose: true, runId: "ts-imperative-fetch-based" });

const demoEscalation = async () => {
    const call: FunctionCall = await hl.createFunctionCall(
        {spec: {
            fn: "multiply",
            kwargs: {"foo":"bar"},
            channel: {
                email: {
                    address: process.env.HL_EXAMPLE_CONTACT_EMAIL || "dexter@humanlayer.dev",
                },
            }}},
    );

    const escalated_call: FunctionCall = await hl.escalateEmailFunctionCall(
        call.call_id, {
            escalation_msg: "please take a look because it's been too long",
            additional_recipients: [{
                address: process.env.HL_EXAMPLE_SECOND_CONTACT_EMAIL || "",
                field: "to"}],
        },
    );

    console.log(`Check your email ${JSON.stringify(escalated_call)}`);
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
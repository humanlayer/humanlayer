import { humanlayer } from "@humanlayer/sdk";

const hlClient = humanlayer({ verbose: true, runId: "spline-reticulator" });

const logger = {
  info: (message: any, data: any) => {
    console.log(message, data);
  },
};

const testRequireApproval = async () => {
  const reticulateSplineImpl = ({ splineArgs }: { splineArgs: string }) => {
    logger.info(splineArgs, "Got an approval to reticulate a spline");
    return Promise.resolve(splineArgs);
  };
  const fnChannel = {
    email: {
      address: process.env.HL_EXAMPLE_CONTACT_EMAIL || "dexter@humanlayer.dev",
      experimental_subject_line: "Reticulating a spline",
      template: `
      <html>
        <body>
          <p style="font-size: 16px; font-weight: bold; border: 1px solid red; padding: 10px; border-radius: 5px;">
            Agent wants to call <pre>{{event.spec.fn}}({{event.spec.kwargs | tojson(indent=2)}})</pre>
          </p>
          <p>
            <a href="{{urls.base_url}}?approve">Approve</a>
            <a href="{{urls.base_url}}?reject">Reject</a>
          </p>
        </body>
      </html>`,
    },
  };
  const approvedReticulateSpline: typeof reticulateSplineImpl =
    hlClient.requireApproval(fnChannel)(
      reticulateSplineImpl,
    ) as typeof reticulateSplineImpl;

  logger.info(
    { approvalMethod: hlClient.approvalMethod },
    "Attempting to get approval from HumanLayer to reticulate a spline",
  );
  const approvalResult = await approvedReticulateSpline({
    splineArgs: "spline::qwq::transform",
  });
  logger.info({ approvalResult }, "HumanLayer approval result");
};

const testHumanAsTool = async () => {
  const hatChannel = {
    email: {
      address: "dexter@humanlayer.dev",
      experimental_subject_line: "Reticulating a spline",
      template: `
      <html>
        <body>
          <p style="font-size: 16px; font-weight: bold; border: 1px solid red; padding: 10px; border-radius: 5px;">
            {{event.spec.msg}}
          </p>
        </body>
      </html>`,
    },
  } as any;
  const humanAsTool = await hlClient.humanAsTool(hatChannel);

  const hatResult = await humanAsTool({
    message: "We are gonna reticulate a spline, which one should we use?",
  });
  logger.info({ hatResult }, "HumanAsTool result");
};

const main = async () => {
  await testRequireApproval();
  await testHumanAsTool();
};

main();

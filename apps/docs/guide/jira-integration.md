# Connect Jira and Create Tasks from Tickets

Connect Jira Cloud so HumanLayer can create tasks from Jira tickets and keep ticket-driven agent work connected to its source.

## Before you start

- You must be an organization admin in HumanLayer.
- You must be able to authorize HumanLayer for the target Jira Cloud site.
- The Jira tickets you use should be in projects your account can access.

## Connect Jira

1. Open HumanLayer in the browser.
2. Go to **Settings**.
3. In **Integrations**, find **Jira**.
4. Click **Connect Jira**.
5. Choose the Jira Cloud site and approve access.
6. Return to HumanLayer and confirm Jira shows as **Connected**.

## Enable task creation

After Jira is connected, keep **Enable Jira Integration** turned on to allow users in the organization to create HumanLayer tasks from Jira tickets.

Turn it off when you want to keep the OAuth connection but temporarily prevent Jira-driven task creation.

## Create and check a task

1. Select **Create Task**.
2. Choose **Jira** as the issue source.
3. Select a ticket that your Jira account can access.
4. Choose a workflow and create the task.

Confirm that the task uses the selected Jira ticket. For help choosing a workflow, read [Run a workflow in HumanLayer](/guide/skills-workflows).

## Reconnect Jira

If Jira shows **Needs Reconnection**, select **Reconnect Jira** and complete the authorization flow again.

## Disconnect Jira

To remove the connection, hover over the **Connected** badge and select **Disconnect?**.

## Troubleshooting

- If the OAuth flow fails, verify you selected the correct Jira Cloud site.
- If users cannot create tasks from Jira tickets, confirm the integration is connected and enabled.
- If a ticket cannot be used, confirm your Jira account can access the project and issue.

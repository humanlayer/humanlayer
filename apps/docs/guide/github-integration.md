# Connect GitHub and Create Tasks from Issues

Connect GitHub to create HumanLayer tasks from issues and link task artifacts back to the source issue. Each installation exposes only the repositories selected during setup, and one HumanLayer organization can connect more than one GitHub account or organization.

## Connect GitHub

You must be a HumanLayer organization admin. The person who installs the GitHub App must also have permission to install apps on the target GitHub account.

1. Open HumanLayer in the browser and go to **Settings**.
2. Under **Integrations**, find **GitHub** and click **Connect GitHub**.
3. Review the permissions, then continue to GitHub.
4. Choose an account and select **All repositories** or **Only select repositories**.
5. Approve the installation and return to HumanLayer.
6. Turn on **Enable GitHub Integration**.

If another GitHub admin must approve the installation, copy the seven-day handoff link from the consent dialog and send it to them.

## Choose repository access

Choose **All repositories** or **Only select repositories** during installation. HumanLayer requests:

- **Contents: read and write** for repository work.
- **Issues: read and write** for issue import and artifact links.
- **Pull requests: read and write** for pull request workflows.
- **Metadata: read** to list repositories.

HumanLayer shows a warning and a repair link when an installation lacks a needed permission.

## Create a task

1. In the desktop app, click **Create Task** and select **GitHub**.
2. Choose an installed repository.
3. Enter an issue number or paste its full GitHub URL.
4. Review the preview, choose a workflow, and create the task.

HumanLayer fetches the issue again during task creation. The resulting `ticket.md` includes the issue details, comments, and source link. Images are stored as task artifacts when possible. If an image cannot be imported, `ticket.md` keeps its original URL instead of linking to a missing artifact.

## Use source-issue artifact links

When an agent updates a task artifact, HumanLayer adds or updates one comment on the source issue with links to the task's current artifacts. Renamed or removed artifacts disappear after the next sync. A failed GitHub update does not block the artifact save.

Artifact links require **Issues: write** access.

## Change or repair repository access

From **Settings**, you can view repositories, refresh permissions and repository access, manage the installation on GitHub, add another installation, or disconnect one installation.

Use **Manage** to change repository selection in GitHub, then **Refresh** to apply the change at once. A suspended installation must be restored in GitHub; reconnecting does not remove a suspension.

## Disconnect GitHub

Disconnect an installation from **Settings > Integrations > GitHub**. If the disconnect fails, HumanLayer keeps the local connection so you can retry without losing its state.

## Troubleshooting

- **Repository missing:** Add it to the GitHub installation, then click **Refresh**.
- **Preview unavailable:** Check that the integration is enabled, the installation is active, and **Issues: read** is granted.
- **Artifact links missing:** Check that the task came from GitHub and **Issues: write** is granted, then save another artifact to retry.
- **Action required:** Ask a HumanLayer admin to create a new installation link.
- **Disconnect failed:** Retry from **Settings > Integrations > GitHub**. HumanLayer keeps the local connection after a failed attempt.

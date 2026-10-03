# Retired Hosting Integration

Production and staging use the VPS, Docker Compose and Caddy. Vercel is no longer
a deployment target. The root `vercel.json` deliberately sets
`git.deploymentEnabled` to `false` for all branches as a defensive guard; it is not
an active hosting configuration. Keep this guard on both `main` and `dev`.

## Disconnect The Provider

The repository guard disables Git-triggered deployments but does not revoke the
provider's access or remove its old project. In the old Vercel project's Settings,
disconnect the Git repository. Alternatively, in GitHub's installed GitHub Apps
settings, configure the Vercel installation to exclude this repository. Do not
uninstall the integration account-wide if other projects still use it.

GitHub CLI repository credentials may manage deployment records without having
permission to manage GitHub App installations. These are separate permissions.

## Old GitHub Deployment Records

The ten May 2026 records created by `vercel[bot]` were archived outside the repository
and removed on October 3, 2026. They were obsolete provider records, not failed
deployments of the current VPS. Cleaning them up did not restart services, delete
the Vercel project, or modify production data.

GitHub deployment history is metadata: it is not a health check for the current
site. Use the VPS release runbook and `/api/health` to verify a real release.
GitHub environments and their secrets are retained, not deleted as part of this cleanup.

References: [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration)
and [GitHub deployment API](https://docs.github.com/en/rest/deployments/deployments).

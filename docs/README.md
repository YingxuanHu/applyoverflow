# Documentation Index

## Current Guides

| Guide | Scope |
| --- | --- |
| [Product and setup](../README.md) | Workflows, local development, configuration |
| [Development guide](../CONTRIBUTING.md) | Changes, testing and release expectations |
| [Production and staging](deployment/staging-production.md) | Current VPS deployment procedure |
| [Retired hosting](deployment/retired-hosting.md) | Vercel disconnect and GitHub deployment cleanup |
| [Extension publishing](extension-web-store.md) | Chrome Web Store distribution |
| [Extension implementation](../extensions/chrome/README.md) | Autofill architecture and testing |
| [Script catalog](../scripts/README.md) | Operational and test commands |
| [Data directory](../data/README.md) | Source datasets versus generated/user data |

## Repository Map

```text
src/app/              Web routes and API handlers
src/components/       Shared UI and feature components
src/lib/              Domain services, query helpers, ingestion and ranking
prisma/               Schema, migrations and database seed
extensions/chrome/    Browser extension source
scripts/              Test, ingestion, repair and maintenance entry points
tests/                Unit, integration and end-to-end tests
deploy/single-vps/    Container, proxy, backup and release configuration
public/               Product assets; generated extension ZIP is ignored
data/                 Curated source inputs and historical operational evidence
docs/                 Current guides, design notes and historical audits
```

## Historical Evidence

The original [single-VPS migration](deployment/single-vps-migration.md) is retained
for recovery context, not as the everyday release procedure. Dated files in
`audits/`, `design/`, and `autofill-*` record earlier decisions or tests; they do not
prove current production behavior. Prefer source code and current runbooks when
historical notes disagree. Existing paths remain stable for references and scripts.

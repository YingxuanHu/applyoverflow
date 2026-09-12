# Production release review

Reviewed `main..dev` at `8c986ce`, including the earlier audit's unresolved release blockers. This review does not certify every application workflow or production capacity.

## Findings corrected before release

1. **P1: Storage retries could remove still-referenced files.** Document deletion now creates durable cleanup intent using a transactional PostgreSQL trigger, including account cascades. Profile deletion removes files only after database commit; retry failures no longer leave live document records pointing at missing files. Retries refuse any key still referenced by a document. Failed account deletion no longer removes files in an authentication before-hook. A local PostgreSQL integration test covers rollback, commit, failure/retry, live-reference protection, and account cascade without making storage requests.
2. **P2: Valid GENERAL roles were excluded.** Explicitly retain non-clinical healthcare and public-sector administration such as Pharmacy Benefits Analyst, Dental Billing Specialist, and Police Records Clerk. Intake and publication tests cover them and retain exclusions for patient-facing/frontline roles. This follows the North America white-collar scope in [AGENTS.md](../../AGENTS.md).
3. **P2: App-only deployment could use old migrations.** Build the maintenance image from the same release even on app-only releases, run migrations with `--no-deps`, and recreate only selected services. Shell-path tests verify command ordering and prevent PostgreSQL dependency recreation.
4. **Deployment safety:** Preserve legacy uploads and automation screenshots during rsync, not only during Docker builds. Add an optional named builder so build cache can live on the attached volume; prune that builder only. This avoids moving the live database or restarting Docker. See [Docker's container builder](https://docs.docker.com/build/builders/drivers/docker-container/) and [Compose build options](https://docs.docker.com/reference/cli/docker/compose/build/).

## Local verification

- Unit suite, TypeScript, ESLint, and production Next build.
- Real PostgreSQL tests for ingestion-to-feed publication, generation budgets/concurrency, and transactional storage deletion.
- Playwright against the production build: sign-in, minimal feed payloads, save/remove cache consistency, default selection, lazy descriptions, equal desktop panels (832/832 px), mobile selection/back, resume landmark, and Picks navigation.
- Three additive migrations are required relative to the previous production release: resource budgets/storage deletion intents, description repair queue enum, and the document-deletion trigger. Do not start new code before applying these migrations.

## Remaining limits

- `npm audit --omit=dev` reports four entries: three high entries in the Prisma CLI/config/deepmerge dependency chain and one low PM2 entry. The suggested automatic fixes are major-version changes/downgrades and are not applied blindly. This is not a zero-vulnerability release. User input was not found to reach Prisma's configuration merge path in this review.
- Two pre-existing unused-parameter lint warnings remain.
- The current production image has no LaTeX compiler; resume PDF generation was not certified by this release review. No new claim is made that this existing deployment limitation is resolved.
- Live paid AI generation, real email/OAuth delivery, and complete-profile ranking refresh are not covered by the local fixture smoke test.
- The September 12 scheduled full backup failed during object-storage DNS resolution; September 11's backup has upload confirmation. Fresh release schema/user-data snapshots are supplementary and not a replacement for a complete off-site backup.

Deployment outcomes and the exact live revision must be confirmed from `/api/health` and container state after rollout, not inferred from a Git push.

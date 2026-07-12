## ApplyOverflow

North America-focused job search and application engine for white-collar roles across tech, finance, and general knowledge-worker functions.

Current implemented slice:

- feed-first `/jobs` experience over a canonical live job pool
- `/jobs` now defaults to live non-demo-backed jobs and resolves outbound links through a trust layer before rendering external actions
- dedicated `/jobs/[id]` detail page with classification, explanation, and source context
- `/jobs/[id]/apply` review flow with resume/package preview, per-job notes, and submission tracking
- shortlist workflow through `/saved`
- application history in `/applications`
- profile editor at `/profile` — contact info, skills, experience, education, projects, preferences
- profile completeness indicator — weighted score showing which fields improve AI quality and application materials
- document upload — PDF/DOCX resume upload with text extraction; documents linked to resume variants
- AI resume ingestion — parse an uploaded resume with OpenAI to populate structured profile fields
- per-job AI workspace — fit analysis (score + strengths/gaps + keywords) and cover letter generation powered by OpenAI
- internal `/ops/*` visibility pages for ingestion, discovery, URL health, and ranking diagnostics; access is restricted by `OPS_ADMIN_EMAILS`
- cron-ready `/api/ingestion/schedule` route for cadence-driven ingestion
- ingestion pipeline with connector interface, normalization, stronger cross-source dedupe, lifecycle sweeps, removal handling, run tracking, feed-index repair, and many ATS/API connectors
- Prisma/Postgres domain model for canonical jobs, raw jobs, source mappings, eligibility, saved jobs, profile data, documents, and submissions
- seeded demo dataset plus live external ingestion for local development
  - demo-backed canonical jobs stay useful for modeling and local data shape checks, but the main feed hides them when they do not have a trustworthy live source

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | Optional | Adzuna job board API credentials |
| `OPENAI_API_KEY` | Optional | Unlocks AI features — resume parsing, fit analysis, cover letter generation |
| `OPENAI_FAST_MODEL` | Optional | Low-latency model for extraction, classification, and cheap background tasks (default: `gpt-5.4-nano`) |
| `OPENAI_STANDARD_MODEL` | Optional | Default model for structured analysis and generation (default: `gpt-5.4-mini`) |
| `OPENAI_REASONING_MODEL` | Optional | Higher-quality model for heavier document generation and review tasks (default: `gpt-5.4`) |
| `OPS_ADMIN_EMAILS` | Required for `/ops/*` access | Comma- or newline-separated email allowlist for ops dashboards |
| `STORAGE_*` | Optional | S3-compatible storage for uploaded and generated documents |

Copy `.env.example` to `.env` and fill in your values. AI features degrade gracefully when `OPENAI_API_KEY` is absent — all other functionality is unaffected.

For split web / worker deployments, keep the web node on `DISABLE_INGEST_DAEMON=1`, set `DATABASE_URL_DO_PRIVATE` for the DigitalOcean VPC database endpoint, and record the worker IPs with `DO_WORKER_DROPLET_IPV4` / `DO_WORKER_DROPLET_PRIVATE_IPV4`. Worker-side Prisma roles now prefer `DATABASE_URL_DO_PRIVATE` automatically unless `DATABASE_PREFER_PRIVATE_FOR_WORKERS=0`.

Lifecycle tuning is now profile-driven through `LIFECYCLE_PROFILE=aggressive|balanced|conservative`, so expiration experiments no longer require editing `src/lib/ingestion/pipeline.ts` directly.

## Local development

Run the app:

```bash
npm run dev
```

`npm run dev` starts the app stack through `scripts/run-app-stack.ts` and defaults to Turbopack with a 2 GB heap cap. Set `BUNDLER=webpack` or use `npm run dev:web` if you need the webpack fallback.

If dev ever looks stuck compiling after a bad edit or stale `.next` state, stop the current dev server and use:

```bash
npm run dev:fresh
```

If you explicitly want Turbopack for comparison, use:

```bash
npm run dev:turbo
```

If you need the old uncapped behavior, use:

```bash
npm run dev:uncapped
```

Validate the repo state:

```bash
npm run lint
npm run typecheck
npm run build
```

Single-VPS production migration notes live in
`docs/deployment/single-vps-migration.md`. That path is intended for the
low-cost test-team setup: one VPS running web, worker, Postgres, Caddy, and
nightly object-storage backups.

Operational growth tooling:

```bash
npm run source:report-lifecycle -- --days=60
npm run source:benchmark-dedupe -- --sample-size=100
npm run source:audit-classifier -- --families=usajobs,jobbank,successfactors
npm run source:demote-stale -- --recent-success-days=7 --no-mapping-days=14
npm run enterprise:preflight -- --family=workday --limit=50 --register --promote
npm run jobs:backfill-feed-index -- --mode=all --batch-size=500
npm run jobs:refresh-feed-summary
```

Seed the local database:

```bash
npx prisma db seed
```

Ingest from a public Greenhouse board:

```bash
npm run ingest -- greenhouse --board=vercel
```

Ingest from a public Lever site:

```bash
npm run ingest -- lever --site=plaid
```

Ingest from public Recruitee company careers endpoints:

```bash
npm run ingest -- recruitee --companies=deephealth,huaweicanada
```

Ingest from a public SmartRecruiters company:

```bash
npm run ingest -- smartrecruiters --company=visa --limit=40
```

Ingest from a public Workday board using a `host|tenant|site` source token:

```bash
npm run ingest -- workday '--source=paypal.wd1.myworkdayjobs.com|paypal|jobs'
```

Preview an ingest batch without writing canonical jobs, raw jobs, or source mappings:

```bash
npm run ingest -- ashby --orgs=alchemy,suno --limit=30 --dry-run
npm run ingest -- recruitee --companies=deephealth,huaweicanada --dry-run
npm run ingest -- rippling --boards=tixr,n3xt-jobs --dry-run
npm run ingest -- workable --account=fairmoney --limit=10 --dry-run
npm run ingest -- workday '--source=guidewire.wd5.myworkdayjobs.com|guidewire|external' --limit=20 --dry-run
```

Discover and validate Rippling board slugs from candidate slugs or Rippling-hosted job URLs:

```bash
npm run rippling:discover -- --slugs=tixr,n3xt-jobs,exacare-inc
npm run rippling:discover -- --urls=https://ats.rippling.com/scratch-financial/jobs/1a4c8667-db66-4b73-9936-28ed66c3a100
npm run rippling:discover -- --urls=https://www.linkedin.com/redir/redirect?url=https%3A%2F%2Fats.rippling.com%2Ffree-market-health%2Fjobs%2F...
```

Persist Rippling discovery state, keep rejected/promoted boards out of the default retest loop, and surface pending high-yield boards for manual promotion:

```bash
npm run rippling:discover -- --threshold=5 --slugs=patientnow,swimlane,tort-experts
npm run rippling:discover -- --promote=patientnow --slugs=patientnow
npm run rippling:discover -- --source-pages=https://example.com/careers,https://example.com/jobs
npm run rippling:discover -- --dataset=/tmp/linkedin-export.json --no-search
npm run rippling:intake -- --dataset=/tmp/linkedin-export.json
npm run rippling:intake -- --dataset=/path/to/corpus-directory
```

Discover ATS sources generically from the live DB, known company pages, or pasted URLs, then persist promoted / rejected / pending source candidates in a reusable registry:

```bash
npm run source:discover
npm run source:discover -- --urls=https://jobs.lever.co/example/123,https://apply.workable.com/example/j/ABC/
npm run source:discover -- --source-pages=https://example.com/careers,https://example.com/jobs
npm run source:discover -- --urls=https://paypal.wd1.myworkdayjobs.com/wday/cxs/paypal/jobs/jobs
npm run source:discover -- --promote=recruitee:greatminds,greenhouse:contentful
```

Promoted entries in `data/discovery/source-candidates.json` are merged into scheduled ingestion automatically, so strong newly discovered boards do not require another hard-coded coverage edit before the next scheduled run.

Generate a reusable seed corpus of candidate ATS URLs, including constrained Workday endpoint guesses for curated tech / finance companies:

```bash
npx tsx scripts/generate-seed.ts --families=workday --out=data/discovery/seeds/workday-candidates.json
npx tsx scripts/discover-sources.ts --dataset=data/discovery/seeds/workday-candidates.json --limit=5
```

## Product direction

- Feed first, apply flow second
- Total live job pool plus stricter ready-to-apply/review/manual quality bands
- Clear classification per job: ready to apply, review required, or manual only
- Deduplication, freshness, expiration tracking, and quality guardrails are foundational
- This is not a blind spam-style mass apply bot

## Main project paths

- `src/app/jobs` — main feed
- `src/app/saved` — redirects to the Applications wishlist view
- `src/app/applications` — package and submission history
- `src/app/profile` — profile editor, completeness indicator, document upload
- `src/app/ops/*` — admin-only ingestion, discovery, health, and ranking diagnostics
- `src/app/api` — route handlers
- `src/lib/queries` — Prisma-backed data access
- `src/lib/ingestion` — connector fetch, normalization, dedupe, lifecycle, eligibility, and scheduling helpers
- `src/lib/ai` — AI modules: provider abstraction, resume parser, profile merge, job fit analysis, cover letter generation
- `src/lib/storage` — S3-compatible document storage with legacy local-read fallback
- `src/lib/resume-ingestion.ts` and `src/lib/profile-resume-service.ts` — document text extraction, AI resume parsing, and structured profile merge
- `src/components/profile` — profile editor, completeness indicator, resume upload, document list
- `src/components/jobs` — job cards, review actions, AI workspace, per-job notes
- `scripts/ingest.ts` — manual ingestion runs
- `prisma/` — schema, migrations, and seed data

Use the actual repository state as the source of truth over older notes or assistant summaries.

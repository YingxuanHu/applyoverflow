# Source Intelligence Baseline

Generated at: 2026-06-25T18:25:28.120Z

Window: last 7 days

## Summary

- Feed-index live jobs: 476209
- Strict canonical-visible jobs: 495395
- Broader canonical visible-status jobs: 520808
- Canonical jobs total: 952714
- Companies: 117052
- Company sources: 20988
- Active validated pollable sources: 13669
- Source candidates: 709270
- ATS tenants: 9495
- Pending source tasks: 8462
- Running source tasks: 22
- Ingestion created in window: 58285
- Ingestion accepted in window: 4630841
- Ingestion novelty rate: 0.0126
- Ingestion duplicate rate: 0.0007

## Source State

- Status: {"ACTIVE":13392,"DEGRADED":3789,"REDISCOVER_REQUIRED":2169,"PROVISIONED":1306,"DISABLED":332}
- Validation: {"VALIDATED":14904,"SUSPECT":2690,"NEEDS_REDISCOVERY":1693,"BLOCKED":901,"INVALID":761,"UNVALIDATED":38,"VALIDATING":1}
- Poll: {"READY":13664,"BACKOFF":4779,"QUARANTINED":2163,"DISABLED":332,"ACTIVE":50}
- Extraction route: {"ATS_NATIVE":9399,"HTML_FALLBACK":5908,"STRUCTURED_SITEMAP":4549,"UNKNOWN":1022,"STRUCTURED_JSON":101,"STRUCTURED_API":9}

## Job State

- Canonical by status: {"LIVE":516250,"REMOVED":370718,"EXPIRED":61188,"STALE":4371,"AGING":187}
- Feed index by status: {"REMOVED":476256,"LIVE":476209,"EXPIRED":216}
- Apply URL validation: {"UNVALIDATED":633465,"ACTIVE":212478,"NEEDS_REVALIDATION":56043,"GENERIC_APPLY_PAGE":31348,"BROKEN_APPLY_LINK":18803,"EXPIRED":507,"HIDDEN_LOW_QUALITY":70}

## Top Sources By Net-New Created Jobs

| source | family | created | accepted | novelty | duplicate | runs |
| --- | --- | --- | --- | --- | --- | --- |
| OfficialCompany:Amazon | officialcompany | 2327 | 555609 | 0.0042 | 0 | 1171 |
| OracleCloud:ejwl.fa.us2 | oraclecloud | 1370 | 24017 | 0.057 | 0 | 55 |
| OracleCloud:eofd.fa.us6 | oraclecloud | 1298 | 28168 | 0.0461 | 0 | 54 |
| OracleCloud:jpmc.fa | oraclecloud | 1173 | 51377 | 0.0228 | 0.0003 | 55 |
| OracleCloud:hcbt.fa.em2 | oraclecloud | 821 | 41820 | 0.0196 | 0 | 53 |
| OfficialCompany:Google | officialcompany | 704 | 89205 | 0.0079 | 0 | 199 |
| Greenhouse:equipmentsharecom | greenhouse | 689 | 40632 | 0.017 | 0 | 48 |
| Workday:dollartree.wd5.myworkdayjobs.com\|dollartree\|dollartreeus | workday | 571 | 1618 | 0.3529 | 0 | 29 |
| Greenhouse:centriaautism | greenhouse | 562 | 60507 | 0.0093 | 0 | 53 |
| OracleCloud:emqk.fa.ca3 | oraclecloud | 536 | 38258 | 0.014 | 0 | 52 |
| SuccessFactors:careers.wrha.mb.ca | successfactors | 497 | 3399 | 0.1462 | 0 | 8 |
| OracleCloud:ejhp.fa.us6 | oraclecloud | 439 | 50443 | 0.0087 | 0 | 57 |
| Greenhouse:speechify | greenhouse | 429 | 14117 | 0.0304 | 0 | 9 |
| OfficialCompany:Microsoft | officialcompany | 420 | 19287 | 0.0218 | 0 | 213 |
| Workday:pae.wd1.myworkdayjobs.com\|pae\|amentum_careers | workday | 418 | 2523 | 0.1657 | 0.0004 | 41 |
| OracleCloud:eodr.fa.us2 | oraclecloud | 412 | 39279 | 0.0105 | 0 | 53 |
| SuccessFactors:jobs.scotiabank.com | successfactors | 411 | 4404 | 0.0933 | 0 | 53 |
| OracleCloud:egup.fa.us2 | oraclecloud | 389 | 46013 | 0.0085 | 0 | 54 |
| Workday:jci.wd5.myworkdayjobs.com\|jci\|jci | workday | 379 | 661 | 0.5734 | 0.0076 | 28 |
| OracleCloud:efet.fa.us2 | oraclecloud | 375 | 26922 | 0.0139 | 0 | 56 |
| Workday:dickssportinggoods.wd1.myworkdayjobs.com\|dickssportinggoods\|dsg | workday | 374 | 1148 | 0.3258 | 0 | 32 |
| Workday:hyvee.wd1.myworkdayjobs.com\|hyvee\|hyveecareers | workday | 373 | 662 | 0.5634 | 0 | 9 |
| Workday:comcast.wd5.myworkdayjobs.com\|comcast\|comcast_careers | workday | 343 | 1136 | 0.3019 | 0 | 8 |
| Workday:medtronic.wd1.myworkdayjobs.com\|medtronic\|medtroniccareers | workday | 341 | 616 | 0.5536 | 0 | 51 |
| CompanyHtml:coolchiptechnologies | companyhtml | 337 | 397 | 0.8489 | 0.1033 | 17 |
| iCIMS:careers-pamhealth | icims | 316 | 10907 | 0.029 | 0 | 51 |
| Greenhouse:stripe | greenhouse | 314 | 22878 | 0.0137 | 0 | 46 |
| Workday:rbc.wd3.myworkdayjobs.com\|rbc\|rbcglobal1 | workday | 314 | 652 | 0.4816 | 0.0031 | 85 |
| OracleCloud:emit.fa.ca3 | oraclecloud | 311 | 43068 | 0.0072 | 0 | 52 |
| Workday:parsons.wd5.myworkdayjobs.com\|parsons\|search | workday | 306 | 1352 | 0.2263 | 0.0274 | 26 |

## Highest Priority Repair Candidates

| company | connector | state | live | quality | yield | failures |
| --- | --- | --- | --- | --- | --- | --- |
| Boeing | workday | ACTIVE/VALIDATED/ACTIVE | 0 | 0.12 | 0.026 | 0 |
| Penn Interactive | company-site | DEGRADED/SUSPECT/BACKOFF | 1 | 0.34 | 0.256 | 32 |
| Cintas | successfactors | DEGRADED/VALIDATED/BACKOFF | 0 | 0.28 | 0.062 | 193 |
| Scotiabank | successfactors | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 1900 | 0.12 | 0.683 | 30 |
| BDC | workday | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 5349 |
| PepsiCo | icims | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 4128 |
| Export Development Canada | workday | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 5347 |
| AtkinsRéalis | workday | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 1960 |
| Microsoft Legal Department | icims | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 9268 |
| Arista Networks | smartrecruiters | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 4178 |
| TransPerfect | recruitee | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0 | 0.026 | 1640 |
| Two Sigma | company-site | ACTIVE/VALIDATED/BACKOFF | 10 | 2.467 | 0.324 | 0 |

## Company Coverage Gaps

| company | sources | active | validated | feedLive | canonicalVisible | quality |
| --- | --- | --- | --- | --- | --- | --- |
| Constellation Energy | 5 | 5 | 5 | 0 | 3 | 0.99 |
| Mountsinai | 3 | 1 | 1 | 1 | 7 | 0.99 |
| Brinqa | 2 | 2 | 2 | 1 | 1 | 0.99 |
| Univar Solutions | 2 | 2 | 2 | 1 | 4 | 0.99 |
| Konica Minolta | 2 | 2 | 2 | 0 | 0 | 0.99 |
| Phenompeople | 1 | 1 | 1 | 1 | 1 | 0.99 |
| Publicis Groupe | 1 | 1 | 1 | 0 | 3 | 0.99 |
| HERSHEY | 1 | 1 | 1 | 1 | 19 | 0.99 |
| Boehringer Ingelheim | 1 | 1 | 1 | 1 | 15 | 0.99 |
| Export Development Canada | 4 | 2 | 2 | 0 | 0 | 0.92 |
| PepsiCo | 4 | 2 | 1 | 2 | 10 | 0.867 |
| Quotient Technology | 2 | 1 | 1 | 0 | 0 | 0.867 |

## Queue Health

| kind | status | count | ready | staleRunning |
| --- | --- | --- | --- | --- |
| COMPANY_DISCOVERY | FAILED | 1 | 0 | 0 |
| COMPANY_DISCOVERY | PENDING | 6 | 4 | 0 |
| COMPANY_DISCOVERY | RUNNING | 3 | 0 | 3 |
| COMPANY_DISCOVERY | SKIPPED | 151 | 0 | 0 |
| COMPANY_DISCOVERY | SUCCESS | 308056 | 0 | 0 |
| CONNECTOR_POLL | FAILED | 894 | 0 | 0 |
| CONNECTOR_POLL | PENDING | 167 | 1 | 0 |
| CONNECTOR_POLL | RUNNING | 1 | 0 | 0 |
| CONNECTOR_POLL | SKIPPED | 33980 | 0 | 0 |
| CONNECTOR_POLL | SUCCESS | 886418 | 0 | 0 |
| REDISCOVERY | FAILED | 5 | 0 | 0 |
| REDISCOVERY | PENDING | 1726 | 0 | 0 |
| REDISCOVERY | SKIPPED | 5417 | 0 | 0 |
| REDISCOVERY | SUCCESS | 188111 | 0 | 0 |
| SOURCE_VALIDATION | PENDING | 40 | 38 | 0 |
| SOURCE_VALIDATION | SKIPPED | 1115 | 0 | 0 |
| SOURCE_VALIDATION | SUCCESS | 1089101 | 0 | 0 |
| URL_HEALTH | FAILED | 483 | 0 | 0 |
| URL_HEALTH | PENDING | 6523 | 6523 | 0 |
| URL_HEALTH | RUNNING | 18 | 0 | 0 |
| URL_HEALTH | SKIPPED | 483 | 0 | 0 |
| URL_HEALTH | SUCCESS | 2091246 | 0 | 0 |

## Phase 1 Use

Use this report as the pre-change benchmark. After source repair, ATS frontier expansion, or scheduler changes, rerun:

```bash
npm run source:intelligence-baseline -- --label=after-phase-1
```

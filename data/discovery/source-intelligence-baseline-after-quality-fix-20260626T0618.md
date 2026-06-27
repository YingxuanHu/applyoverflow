# Source Intelligence Baseline

Generated at: 2026-06-26T06:15:39.201Z

Window: last 7 days

## Summary

- Feed-index live jobs: 478076
- Strict canonical-visible jobs: 496957
- Broader canonical visible-status jobs: 522633
- Canonical jobs total: 966410
- Companies: 117122
- Company sources: 21069
- Active validated pollable sources: 13763
- Source candidates: 709270
- ATS tenants: 9495
- Pending source tasks: 7877
- Running source tasks: 56
- Ingestion created in window: 67732
- Ingestion accepted in window: 4597205
- Ingestion novelty rate: 0.0147
- Ingestion duplicate rate: 0.0008

## Source State

- Status: {"ACTIVE":13461,"DEGRADED":3796,"REDISCOVER_REQUIRED":2162,"PROVISIONED":1320,"DISABLED":330}
- Validation: {"VALIDATED":15033,"SUSPECT":2639,"NEEDS_REDISCOVERY":1678,"BLOCKED":936,"INVALID":767,"UNVALIDATED":15,"VALIDATING":1}
- Poll: {"READY":13722,"BACKOFF":4798,"QUARANTINED":2156,"DISABLED":330,"ACTIVE":63}
- Extraction route: {"ATS_NATIVE":9420,"HTML_FALLBACK":5941,"STRUCTURED_SITEMAP":4574,"UNKNOWN":1020,"STRUCTURED_JSON":105,"STRUCTURED_API":9}

## Job State

- Canonical by status: {"LIVE":518187,"REMOVED":383204,"EXPIRED":60573,"STALE":4116,"AGING":330}
- Feed index by status: {"REMOVED":488085,"LIVE":478076,"EXPIRED":216}
- Apply URL validation: {"UNVALIDATED":637006,"ACTIVE":216816,"NEEDS_REVALIDATION":60297,"GENERIC_APPLY_PAGE":31848,"BROKEN_APPLY_LINK":19856,"EXPIRED":519,"HIDDEN_LOW_QUALITY":68}

## Top Sources By Net-New Created Jobs

| source | family | created | accepted | novelty | duplicate | runs |
| --- | --- | --- | --- | --- | --- | --- |
| OfficialCompany:Amazon | officialcompany | 2387 | 531527 | 0.0045 | 0 | 1122 |
| OracleCloud:ejwl.fa.us2 | oraclecloud | 1345 | 23968 | 0.0561 | 0 | 54 |
| OracleCloud:eofd.fa.us6 | oraclecloud | 1258 | 28109 | 0.0448 | 0 | 54 |
| OracleCloud:jpmc.fa | oraclecloud | 1133 | 50452 | 0.0225 | 0.0003 | 54 |
| OracleCloud:hcbt.fa.em2 | oraclecloud | 831 | 41207 | 0.0202 | 0 | 52 |
| OfficialCompany:Google | officialcompany | 771 | 92805 | 0.0083 | 0 | 207 |
| Greenhouse:equipmentsharecom | greenhouse | 696 | 44266 | 0.0157 | 0 | 52 |
| Greenhouse:centriaautism | greenhouse | 606 | 60592 | 0.01 | 0 | 53 |
| Workday:dollartree.wd5.myworkdayjobs.com\|dollartree\|dollartreeus | workday | 571 | 1618 | 0.3529 | 0 | 30 |
| OracleCloud:emqk.fa.ca3 | oraclecloud | 500 | 36224 | 0.0138 | 0 | 50 |
| SuccessFactors:careers.wrha.mb.ca | successfactors | 500 | 3937 | 0.127 | 0 | 9 |
| iCIMS:instructional-scsk12 | icims | 493 | 493 | 1 | 0 | 1 |
| OracleCloud:ejhp.fa.us6 | oraclecloud | 453 | 49404 | 0.0092 | 0 | 56 |
| Greenhouse:speechify | greenhouse | 429 | 8227 | 0.0521 | 0 | 5 |
| Workday:comcast.wd5.myworkdayjobs.com\|comcast\|comcast_careers | workday | 418 | 1273 | 0.3284 | 0 | 10 |
| OracleCloud:egup.fa.us2 | oraclecloud | 409 | 46006 | 0.0089 | 0 | 54 |
| iCIMS:careers-pamhealth | icims | 401 | 10283 | 0.039 | 0 | 56 |
| OracleCloud:eodr.fa.us2 | oraclecloud | 394 | 37824 | 0.0104 | 0 | 52 |
| Workday:dickssportinggoods.wd1.myworkdayjobs.com\|dickssportinggoods\|dsg | workday | 392 | 1167 | 0.3359 | 0 | 29 |
| Workday:jci.wd5.myworkdayjobs.com\|jci\|jci | workday | 379 | 661 | 0.5734 | 0.0076 | 29 |
| Workday:hyvee.wd1.myworkdayjobs.com\|hyvee\|hyveecareers | workday | 373 | 662 | 0.5634 | 0 | 13 |
| Workday:rbc.wd3.myworkdayjobs.com\|rbc\|rbcglobal1 | workday | 364 | 709 | 0.5134 | 0.0028 | 84 |
| OracleCloud:efet.fa.us2 | oraclecloud | 360 | 26144 | 0.0138 | 0 | 55 |
| SuccessFactors:jobs.scotiabank.com | successfactors | 357 | 3622 | 0.0986 | 0.0014 | 50 |
| Workday:gehc.wd5.myworkdayjobs.com\|gehc\|gehc_externalsite | workday | 357 | 2841 | 0.1257 | 0.0292 | 23 |

## Highest Priority Repair Candidates

| company | connector | state | live | quality | yield | failures |
| --- | --- | --- | --- | --- | --- | --- |
| Boeing | workday | ACTIVE/VALIDATED/ACTIVE | 0 | 0.12 | 0.026 | 0 |
| Scotiabank | successfactors | DEGRADED/VALIDATED/BACKOFF | 1900 | 0.786 | 0.829 | 6 |
| AAR | taleo | DEGRADED/VALIDATED/BACKOFF | 1 | 0.45 | 0.636 | 0 |
| Penn Interactive | company-site | DEGRADED/SUSPECT/BACKOFF | 1 | 0.34 | 0.256 | 35 |
| Constellation Energy | company-site | DEGRADED/SUSPECT/BACKOFF | 1 | 0.2 | 0.337 | 1 |
| Cintas | successfactors | DEGRADED/VALIDATED/BACKOFF | 0 | 0.2 | 0.062 | 197 |
| Export Development Canada | workday | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 5347 |
| AtkinsRéalis | workday | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 1960 |
| PepsiCo | icims | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 4128 |
| Microsoft Legal Department | icims | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 9268 |
| Arista Networks | smartrecruiters | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 4178 |
| BDC | workday | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 5349 |

## Company Coverage Gaps

| company | sources | active | validated | feedLive | canonicalVisible | quality |
| --- | --- | --- | --- | --- | --- | --- |
| Mahindra Group | 2 | 2 | 2 | 0 | 0 | 0.99 |
| Lam Research | 2 | 2 | 2 | 0 | 8 | 0.99 |
| K4Connect | 1 | 1 | 1 | 2 | 2 | 0.99 |
| QuikTrip | 1 | 1 | 1 | 2 | 19 | 0.99 |
| Fujitsu | 1 | 1 | 1 | 1 | 11 | 0.99 |
| Micron Technology | 1 | 1 | 1 | 2 | 2 | 0.99 |
| Pegasystems | 1 | 1 | 1 | 0 | 0 | 0.99 |
| Boehringer Ingelheim | 1 | 1 | 1 | 1 | 17 | 0.99 |
| Constellation Energy | 5 | 5 | 4 | 0 | 3 | 0.92 |
| Export Development Canada | 4 | 2 | 2 | 0 | 0 | 0.92 |
| PepsiCo | 4 | 2 | 1 | 2 | 10 | 0.867 |
| Quotient Technology | 2 | 1 | 1 | 0 | 0 | 0.867 |

## Queue Health

| kind | status | count | ready | staleRunning |
| --- | --- | --- | --- | --- |
| COMPANY_DISCOVERY | FAILED | 1 | 0 | 0 |
| COMPANY_DISCOVERY | RUNNING | 46 | 0 | 0 |
| COMPANY_DISCOVERY | SKIPPED | 153 | 0 | 0 |
| COMPANY_DISCOVERY | SUCCESS | 313084 | 0 | 0 |
| CONNECTOR_POLL | FAILED | 894 | 0 | 0 |
| CONNECTOR_POLL | PENDING | 849 | 19 | 0 |
| CONNECTOR_POLL | RUNNING | 8 | 0 | 0 |
| CONNECTOR_POLL | SKIPPED | 36459 | 0 | 0 |
| CONNECTOR_POLL | SUCCESS | 895321 | 0 | 0 |
| REDISCOVERY | FAILED | 5 | 0 | 0 |
| REDISCOVERY | PENDING | 1723 | 0 | 0 |
| REDISCOVERY | RUNNING | 2 | 0 | 1 |
| REDISCOVERY | SKIPPED | 5699 | 0 | 0 |
| REDISCOVERY | SUCCESS | 189627 | 0 | 0 |
| SOURCE_VALIDATION | PENDING | 17 | 15 | 0 |
| SOURCE_VALIDATION | SKIPPED | 1120 | 0 | 0 |
| SOURCE_VALIDATION | SUCCESS | 1106474 | 0 | 0 |
| URL_HEALTH | FAILED | 483 | 0 | 0 |
| URL_HEALTH | PENDING | 5288 | 5288 | 0 |
| URL_HEALTH | SKIPPED | 483 | 0 | 0 |
| URL_HEALTH | SUCCESS | 2256956 | 0 | 0 |

## Phase 1 Use

Use this report as the pre-change benchmark. After source repair, ATS frontier expansion, or scheduler changes, rerun:

```bash
npm run source:intelligence-baseline -- --label=after-phase-1
```

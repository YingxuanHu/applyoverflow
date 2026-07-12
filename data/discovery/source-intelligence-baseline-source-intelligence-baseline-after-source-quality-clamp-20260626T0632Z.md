# Source Intelligence Baseline

Generated at: 2026-06-26T06:33:00.155Z

Window: last 7 days

## Summary

- Feed-index live jobs: 478210
- Strict canonical-visible jobs: 497014
- Broader canonical visible-status jobs: 522720
- Canonical jobs total: 966544
- Companies: 117122
- Company sources: 21069
- Active validated pollable sources: 13770
- Source candidates: 709270
- ATS tenants: 9495
- Pending source tasks: 8401
- Running source tasks: 51
- Ingestion created in window: 67843
- Ingestion accepted in window: 4590597
- Ingestion novelty rate: 0.0148
- Ingestion duplicate rate: 0.0008

## Source State

- Status: {"ACTIVE":13470,"DEGRADED":3787,"REDISCOVER_REQUIRED":2177,"PROVISIONED":1305,"DISABLED":330}
- Validation: {"VALIDATED":15041,"SUSPECT":2628,"NEEDS_REDISCOVERY":1693,"BLOCKED":936,"INVALID":767,"VALIDATING":3,"UNVALIDATED":1}
- Poll: {"READY":13713,"BACKOFF":4790,"QUARANTINED":2171,"DISABLED":330,"ACTIVE":65}
- Extraction route: {"ATS_NATIVE":9420,"HTML_FALLBACK":5941,"STRUCTURED_SITEMAP":4574,"UNKNOWN":1020,"STRUCTURED_JSON":105,"STRUCTURED_API":9}

## Job State

- Canonical by status: {"LIVE":518233,"REMOVED":383219,"EXPIRED":60605,"STALE":4163,"AGING":324}
- Feed index by status: {"REMOVED":488130,"LIVE":478165,"EXPIRED":216}
- Apply URL validation: {"UNVALIDATED":637107,"ACTIVE":216788,"NEEDS_REVALIDATION":60347,"GENERIC_APPLY_PAGE":31857,"BROKEN_APPLY_LINK":19858,"EXPIRED":519,"HIDDEN_LOW_QUALITY":68}

## Top Sources By Net-New Created Jobs

| source | family | created | accepted | novelty | duplicate | runs |
| --- | --- | --- | --- | --- | --- | --- |
| OfficialCompany:Amazon | officialcompany | 2387 | 531527 | 0.0045 | 0 | 1122 |
| OracleCloud:ejwl.fa.us2 | oraclecloud | 1345 | 23968 | 0.0561 | 0 | 54 |
| OracleCloud:eofd.fa.us6 | oraclecloud | 1258 | 27587 | 0.0456 | 0 | 53 |
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
| OracleCloud:eodr.fa.us2 | oraclecloud | 394 | 37092 | 0.0106 | 0 | 51 |
| Workday:dickssportinggoods.wd1.myworkdayjobs.com\|dickssportinggoods\|dsg | workday | 392 | 1167 | 0.3359 | 0 | 29 |
| Workday:jci.wd5.myworkdayjobs.com\|jci\|jci | workday | 379 | 661 | 0.5734 | 0.0076 | 29 |
| Workday:hyvee.wd1.myworkdayjobs.com\|hyvee\|hyveecareers | workday | 373 | 662 | 0.5634 | 0 | 13 |
| Workday:rbc.wd3.myworkdayjobs.com\|rbc\|rbcglobal1 | workday | 364 | 709 | 0.5134 | 0.0028 | 84 |
| SuccessFactors:jobs.scotiabank.com | successfactors | 363 | 3687 | 0.0985 | 0.0014 | 51 |
| OracleCloud:efet.fa.us2 | oraclecloud | 360 | 26144 | 0.0138 | 0 | 55 |
| Workday:gehc.wd5.myworkdayjobs.com\|gehc\|gehc_externalsite | workday | 357 | 2841 | 0.1257 | 0.0292 | 23 |
| Greenhouse:andurilindustries | greenhouse | 348 | 24369 | 0.0143 | 0 | 15 |
| Workday:pae.wd1.myworkdayjobs.com\|pae\|amentum_careers | workday | 344 | 2203 | 0.1562 | 0.0005 | 35 |
| Workday:medtronic.wd1.myworkdayjobs.com\|medtronic\|medtroniccareers | workday | 341 | 616 | 0.5536 | 0 | 56 |
| OracleCloud:emit.fa.ca3 | oraclecloud | 334 | 43129 | 0.0077 | 0 | 52 |
| Workday:icon.wd3.myworkdayjobs.com\|icon\|broadbean_external | workday | 331 | 722 | 0.4584 | 0 | 2 |

## Highest Priority Repair Candidates

| company | connector | state | live | quality | yield | failures |
| --- | --- | --- | --- | --- | --- | --- |
| Boeing | workday | ACTIVE/VALIDATED/ACTIVE | 0 | 0.12 | 0.026 | 0 |
| Scotiabank | successfactors | DEGRADED/VALIDATED/BACKOFF | 1900 | 0.707 | 0.812 | 7 |
| AAR | taleo | DEGRADED/VALIDATED/BACKOFF | 1 | 0.45 | 0.636 | 0 |
| Penn Interactive | company-site | DEGRADED/SUSPECT/BACKOFF | 1 | 0.34 | 0.256 | 35 |
| Constellation Energy | company-site | DEGRADED/SUSPECT/BACKOFF | 1 | 0.2 | 0.337 | 1 |
| Cintas | successfactors | DEGRADED/VALIDATED/BACKOFF | 0 | 0.2 | 0.062 | 197 |
| AtkinsRéalis | workday | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 1960 |
| PepsiCo | icims | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 4128 |
| Microsoft Legal Department | icims | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 9268 |
| Export Development Canada | workday | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 5347 |
| BDC | workday | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 5349 |
| Arista Networks | smartrecruiters | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 4178 |

## Company Coverage Gaps

| company | sources | active | validated | feedLive | canonicalVisible | quality |
| --- | --- | --- | --- | --- | --- | --- |
| Lam Research | 2 | 2 | 2 | 0 | 8 | 0.99 |
| Mahindra Group | 2 | 2 | 2 | 0 | 0 | 0.99 |
| QuikTrip | 1 | 1 | 1 | 2 | 19 | 0.99 |
| Boehringer Ingelheim | 1 | 1 | 1 | 1 | 17 | 0.99 |
| Micron Technology | 1 | 1 | 1 | 2 | 2 | 0.99 |
| Pegasystems | 1 | 1 | 1 | 0 | 0 | 0.99 |
| Fujitsu | 1 | 1 | 1 | 1 | 11 | 0.99 |
| K4Connect | 1 | 1 | 1 | 2 | 2 | 0.99 |
| Constellation Energy | 5 | 5 | 4 | 0 | 3 | 0.92 |
| Export Development Canada | 4 | 2 | 2 | 0 | 0 | 0.92 |
| PepsiCo | 4 | 1 | 1 | 2 | 10 | 0.867 |
| Quotient Technology | 2 | 1 | 1 | 0 | 0 | 0.867 |

## Queue Health

| kind | status | count | ready | staleRunning |
| --- | --- | --- | --- | --- |
| COMPANY_DISCOVERY | FAILED | 1 | 0 | 0 |
| COMPANY_DISCOVERY | PENDING | 50 | 50 | 0 |
| COMPANY_DISCOVERY | SKIPPED | 153 | 0 | 0 |
| COMPANY_DISCOVERY | SUCCESS | 313374 | 0 | 0 |
| CONNECTOR_POLL | FAILED | 894 | 0 | 0 |
| CONNECTOR_POLL | PENDING | 835 | 1 | 0 |
| CONNECTOR_POLL | RUNNING | 14 | 0 | 0 |
| CONNECTOR_POLL | SKIPPED | 36634 | 0 | 0 |
| CONNECTOR_POLL | SUCCESS | 895386 | 0 | 0 |
| REDISCOVERY | FAILED | 5 | 0 | 0 |
| REDISCOVERY | PENDING | 1739 | 2 | 0 |
| REDISCOVERY | RUNNING | 1 | 0 | 1 |
| REDISCOVERY | SKIPPED | 5704 | 0 | 0 |
| REDISCOVERY | SUCCESS | 189646 | 0 | 0 |
| SOURCE_VALIDATION | PENDING | 2 | 0 | 0 |
| SOURCE_VALIDATION | RUNNING | 36 | 0 | 0 |
| SOURCE_VALIDATION | SKIPPED | 1120 | 0 | 0 |
| SOURCE_VALIDATION | SUCCESS | 1106832 | 0 | 0 |
| URL_HEALTH | FAILED | 483 | 0 | 0 |
| URL_HEALTH | PENDING | 5775 | 5775 | 0 |
| URL_HEALTH | SKIPPED | 483 | 0 | 0 |
| URL_HEALTH | SUCCESS | 2261456 | 0 | 0 |

## Phase 1 Use

Use this report as the pre-change benchmark. After source repair, ATS frontier expansion, or scheduler changes, rerun:

```bash
npm run source:intelligence-baseline -- --label=after-phase-1
```

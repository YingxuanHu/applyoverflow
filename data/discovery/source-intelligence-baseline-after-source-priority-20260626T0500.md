# Source Intelligence Baseline

Generated at: 2026-06-26T04:59:12.152Z

Window: last 7 days

## Summary

- Feed-index live jobs: 477786
- Strict canonical-visible jobs: 496342
- Broader canonical visible-status jobs: 522101
- Canonical jobs total: 964733
- Companies: 117108
- Company sources: 21058
- Active validated pollable sources: 13768
- Source candidates: 709270
- ATS tenants: 9495
- Pending source tasks: 7380
- Running source tasks: 142
- Ingestion created in window: 66327
- Ingestion accepted in window: 4606703
- Ingestion novelty rate: 0.0144
- Ingestion duplicate rate: 0.0008

## Source State

- Status: {"ACTIVE":13468,"DEGRADED":3772,"REDISCOVER_REQUIRED":2178,"PROVISIONED":1311,"DISABLED":330}
- Validation: {"VALIDATED":15033,"SUSPECT":2618,"NEEDS_REDISCOVERY":1694,"BLOCKED":933,"INVALID":767,"UNVALIDATED":7,"VALIDATING":7}
- Poll: {"READY":13727,"BACKOFF":4775,"QUARANTINED":2172,"DISABLED":330,"ACTIVE":55}
- Extraction route: {"ATS_NATIVE":9420,"HTML_FALLBACK":5937,"STRUCTURED_SITEMAP":4568,"UNKNOWN":1020,"STRUCTURED_JSON":105,"STRUCTURED_API":9}

## Job State

- Canonical by status: {"LIVE":517720,"REMOVED":382104,"EXPIRED":60528,"STALE":4052,"AGING":329}
- Feed index by status: {"REMOVED":487076,"LIVE":477408,"EXPIRED":216}
- Apply URL validation: {"UNVALIDATED":636131,"ACTIVE":216159,"NEEDS_REVALIDATION":60173,"GENERIC_APPLY_PAGE":31838,"BROKEN_APPLY_LINK":19845,"EXPIRED":519,"HIDDEN_LOW_QUALITY":68}

## Top Sources By Net-New Created Jobs

| source | family | created | accepted | novelty | duplicate | runs |
| --- | --- | --- | --- | --- | --- | --- |
| OfficialCompany:Amazon | officialcompany | 2394 | 538072 | 0.0044 | 0 | 1136 |
| OracleCloud:ejwl.fa.us2 | oraclecloud | 1349 | 24123 | 0.0559 | 0 | 55 |
| OracleCloud:eofd.fa.us6 | oraclecloud | 1258 | 28109 | 0.0448 | 0 | 54 |
| OracleCloud:jpmc.fa | oraclecloud | 1133 | 50452 | 0.0225 | 0.0003 | 54 |
| OracleCloud:hcbt.fa.em2 | oraclecloud | 831 | 41207 | 0.0202 | 0 | 52 |
| OfficialCompany:Google | officialcompany | 771 | 92805 | 0.0083 | 0 | 207 |
| Greenhouse:equipmentsharecom | greenhouse | 695 | 43357 | 0.016 | 0 | 51 |
| Greenhouse:centriaautism | greenhouse | 606 | 60592 | 0.01 | 0 | 53 |
| Workday:dollartree.wd5.myworkdayjobs.com\|dollartree\|dollartreeus | workday | 571 | 1618 | 0.3529 | 0 | 30 |
| OracleCloud:emqk.fa.ca3 | oraclecloud | 500 | 36224 | 0.0138 | 0 | 50 |
| SuccessFactors:careers.wrha.mb.ca | successfactors | 500 | 3937 | 0.127 | 0 | 9 |
| OracleCloud:ejhp.fa.us6 | oraclecloud | 453 | 50353 | 0.009 | 0 | 57 |
| Greenhouse:speechify | greenhouse | 429 | 8227 | 0.0521 | 0 | 5 |
| Workday:comcast.wd5.myworkdayjobs.com\|comcast\|comcast_careers | workday | 418 | 1273 | 0.3284 | 0 | 10 |
| OracleCloud:egup.fa.us2 | oraclecloud | 415 | 46870 | 0.0089 | 0 | 55 |
| iCIMS:careers-pamhealth | icims | 401 | 10283 | 0.039 | 0 | 56 |
| OracleCloud:eodr.fa.us2 | oraclecloud | 394 | 37824 | 0.0104 | 0 | 52 |
| Workday:jci.wd5.myworkdayjobs.com\|jci\|jci | workday | 379 | 661 | 0.5734 | 0.0076 | 29 |
| Workday:dickssportinggoods.wd1.myworkdayjobs.com\|dickssportinggoods\|dsg | workday | 374 | 1148 | 0.3258 | 0 | 28 |
| Workday:hyvee.wd1.myworkdayjobs.com\|hyvee\|hyveecareers | workday | 373 | 662 | 0.5634 | 0 | 13 |
| Workday:rbc.wd3.myworkdayjobs.com\|rbc\|rbcglobal1 | workday | 364 | 709 | 0.5134 | 0.0028 | 85 |
| OracleCloud:efet.fa.us2 | oraclecloud | 362 | 26646 | 0.0136 | 0 | 56 |
| SuccessFactors:jobs.scotiabank.com | successfactors | 359 | 4060 | 0.0884 | 0.0012 | 53 |
| Workday:gehc.wd5.myworkdayjobs.com\|gehc\|gehc_externalsite | workday | 357 | 2841 | 0.1257 | 0.0292 | 23 |
| Greenhouse:andurilindustries | greenhouse | 346 | 22291 | 0.0155 | 0 | 14 |

## Highest Priority Repair Candidates

| company | connector | state | live | quality | yield | failures |
| --- | --- | --- | --- | --- | --- | --- |
| Boeing | workday | ACTIVE/VALIDATED/ACTIVE | 0 | 0.12 | 0.026 | 0 |
| Scotiabank | successfactors | DEGRADED/VALIDATED/BACKOFF | 1900 | 0.786 | 0.829 | 6 |
| Penn Interactive | company-site | DEGRADED/SUSPECT/BACKOFF | 1 | 0.34 | 0.256 | 35 |
| Cintas | successfactors | DEGRADED/VALIDATED/BACKOFF | 0 | 0.2 | 0.062 | 197 |
| Export Development Canada | workday | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 5347 |
| PepsiCo | icims | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 4128 |
| Microsoft Legal Department | icims | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 9268 |
| Arista Networks | smartrecruiters | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 4178 |
| BDC | workday | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 5349 |
| AtkinsRéalis | workday | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0.12 | 0.026 | 1960 |
| TransPerfect | recruitee | REDISCOVER_REQUIRED/SUSPECT/QUARANTINED | 0 | 0 | 0.026 | 1640 |
| Targetbase | greenhouse | ACTIVE/VALIDATED/READY | 0 | 2.52 | 0.667 | 0 |

## Company Coverage Gaps

| company | sources | active | validated | feedLive | canonicalVisible | quality |
| --- | --- | --- | --- | --- | --- | --- |
| Constellation Energy | 5 | 5 | 5 | 0 | 3 | 0.99 |
| Mahindra Group | 2 | 2 | 2 | 0 | 0 | 0.99 |
| Brinqa | 2 | 2 | 2 | 2 | 2 | 0.99 |
| K4Connect | 1 | 1 | 1 | 2 | 2 | 0.99 |
| Micron Technology | 1 | 1 | 1 | 2 | 2 | 0.99 |
| Boehringer Ingelheim | 1 | 1 | 1 | 1 | 17 | 0.99 |
| Export Development Canada | 4 | 2 | 2 | 0 | 0 | 0.92 |
| PepsiCo | 4 | 2 | 1 | 2 | 10 | 0.867 |
| Quotient Technology | 2 | 1 | 1 | 0 | 0 | 0.867 |
| BDC | 2 | 1 | 1 | 0 | 0 | 0.62 |
| AtkinsRéalis | 2 | 1 | 0 | 0 | 0 | 0.2 |
| Microsoft Legal Department | 2 | 0 | 0 | 0 | 0 | 0.12 |

## Queue Health

| kind | status | count | ready | staleRunning |
| --- | --- | --- | --- | --- |
| COMPANY_DISCOVERY | FAILED | 1 | 0 | 0 |
| COMPANY_DISCOVERY | RUNNING | 57 | 0 | 57 |
| COMPANY_DISCOVERY | SKIPPED | 153 | 0 | 0 |
| COMPANY_DISCOVERY | SUCCESS | 312617 | 0 | 0 |
| CONNECTOR_POLL | FAILED | 894 | 0 | 0 |
| CONNECTOR_POLL | PENDING | 732 | 2 | 0 |
| CONNECTOR_POLL | RUNNING | 3 | 0 | 0 |
| CONNECTOR_POLL | SKIPPED | 36225 | 0 | 0 |
| CONNECTOR_POLL | SUCCESS | 894898 | 0 | 0 |
| REDISCOVERY | FAILED | 5 | 0 | 0 |
| REDISCOVERY | PENDING | 1738 | 14 | 0 |
| REDISCOVERY | RUNNING | 10 | 0 | 9 |
| REDISCOVERY | SKIPPED | 5669 | 0 | 0 |
| REDISCOVERY | SUCCESS | 189454 | 0 | 0 |
| SOURCE_VALIDATION | PENDING | 5 | 0 | 0 |
| SOURCE_VALIDATION | RUNNING | 72 | 0 | 0 |
| SOURCE_VALIDATION | SKIPPED | 1118 | 0 | 0 |
| SOURCE_VALIDATION | SUCCESS | 1104656 | 0 | 0 |
| URL_HEALTH | FAILED | 483 | 0 | 0 |
| URL_HEALTH | PENDING | 4905 | 4905 | 0 |
| URL_HEALTH | SKIPPED | 483 | 0 | 0 |
| URL_HEALTH | SUCCESS | 2238956 | 0 | 0 |

## Phase 1 Use

Use this report as the pre-change benchmark. After source repair, ATS frontier expansion, or scheduler changes, rerun:

```bash
npm run source:intelligence-baseline -- --label=after-phase-1
```

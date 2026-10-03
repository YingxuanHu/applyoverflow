# Data Directory

This directory mixes curated discovery inputs with historical import/export evidence.
It is not a backup of the production database.

- `discovery/seeds/`, imports and inventories provide source-discovery inputs.
- `discovery/reports/` and `exports/` retain earlier audits and reconciliation results.
- Taxonomy and labeling CSVs support classification and review workflows.
- `uploads/` and `automation-screenshots/` are private/generated runtime artifacts:
  they must remain ignored and must not be committed.

Do not bulk-delete or relocate datasets merely because they are old. Some paths
are defaults in ingestion code or documented operational commands. Audit consumers
and preserve recovery copies before retiring an input. New transient reports belong
under ignored `output/`; promote only reviewed, sanitized evidence into this directory.

Production documents and database backups belong in private managed storage,
not Git. Removing a file from the current tree does not remove it from Git history.

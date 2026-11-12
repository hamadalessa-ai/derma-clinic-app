# Database upgrades for real clinics

The demo is updated by `db/reset.sql` + `db/setup.sql` (delete everything, rebuild). That is fine
for fake data only — and `db/reset.sql` now **refuses to run** once the database holds any real
patient (a patient not marked fake, or any patient of a non-demo clinic).

Once a real clinic is live, schema changes ship here instead, as numbered files that keep data:

- `0001_short_name.sql`, `0002_…` — applied in order, each exactly once, each one transaction
  (`begin;` … `commit;`), written to work without superuser rights.
- Only additive or carefully migrated changes (add column with default, backfill, then constrain);
  never `drop table` on data that matters.
- The "Update demo database" workflow must be switched off for that database first.

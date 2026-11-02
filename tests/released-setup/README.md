# Released setup.sql files

The exact `db/setup.sql` of each released phase (copied from git at each merge). The live demo database
may have been built from any of them, so `tests/reset-cycle.test.ts` checks that today's
`db/reset.sql` removes everything each of them created. When a phase is released, add its file here.

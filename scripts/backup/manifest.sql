-- Row count of every table in the app's schemas (public, ops): the backup's "manifest".
-- Used before/after the dump and again after a test restore, to prove the copy is complete.
select format('%s.%s', table_schema, table_name) as tbl,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name),
                           false, true, '')))[1]::text::bigint as n
  from information_schema.tables
 where table_schema in ('public', 'ops') and table_type = 'BASE TABLE'
 order by 1;

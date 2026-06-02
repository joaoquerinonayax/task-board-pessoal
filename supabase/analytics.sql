-- =============================================================================
--  Task Board — Analytics support  (run AFTER schema.sql)
-- -----------------------------------------------------------------------------
--  Adds the column used by the Analytics dashboard to track WHEN a task was
--  completed (moved to the "Done" column). Safe to run more than once.
--
--  If you created the tasks table with the latest schema.sql, this column may
--  already exist — the IF NOT EXISTS makes re-running harmless.
-- =============================================================================

alter table public.tasks add column if not exists completed_at timestamptz;

-- Done. The Analytics tab will start charting completions from now on.

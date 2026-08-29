-- Migration 0002 - Add email read status tracking
-- This migration was originally applied manually. The DDL (ALTER TABLE, CREATE INDEX)
-- is already present in the database. This file now only marks the migration as applied
-- in wrangler's tracking table so it won't be re-run.
--
-- If deploying to a BRAND NEW database, run migration 0001 first which includes
-- the complete schema with all columns.

-- Mark this migration as applied (no DDL needed - already applied)
INSERT OR IGNORE INTO migrations (name, applied_at) VALUES 
    ('0002_add_email_read_status.sql', strftime('%s', 'now'));

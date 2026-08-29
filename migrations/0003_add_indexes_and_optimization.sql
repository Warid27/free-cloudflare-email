-- Migration 0003 - Add composite indexes for common JOIN patterns
-- This migration was originally applied manually. The indexes are already
-- present in the database. This file now only marks the migration as applied
-- in wrangler's tracking table so it won't be re-run.

-- Mark this migration as applied (no DDL needed - already applied)
INSERT OR IGNORE INTO migrations (name, applied_at) VALUES 
    ('0003_add_indexes_and_optimization.sql', strftime('%s', 'now'));

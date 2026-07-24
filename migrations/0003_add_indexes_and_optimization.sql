-- Migration 0003 - Add composite indexes for common JOIN patterns
-- These indexes optimize the most frequent query patterns in the application

-- Composite index for email ownership verification (emails JOIN email_addresses)
-- Optimizes: SELECT e.id FROM emails e INNER JOIN email_addresses ea ON e.address_id = ea.id WHERE e.id = ? AND ea.user_id = ?
CREATE INDEX IF NOT EXISTS idx_emails_address_id_user ON emails(address_id);

-- Composite index for listing emails by address with ordering
-- Optimizes: SELECT ... FROM emails WHERE address_id = ? ORDER BY received_at DESC
CREATE INDEX IF NOT EXISTS idx_emails_address_received ON emails(address_id, received_at DESC);

-- Composite index for listing all emails for a user with ordering
-- Optimizes: SELECT ... FROM emails e INNER JOIN email_addresses ea WHERE ea.user_id = ? ORDER BY e.received_at DESC
CREATE INDEX IF NOT EXISTS idx_email_addresses_user ON email_addresses(user_id, id);

-- Composite index for send permission checks
-- Optimizes: SELECT status FROM send_permissions WHERE address_id = ? AND status = ?
CREATE INDEX IF NOT EXISTS idx_send_permissions_address_status ON send_permissions(address_id, status);

-- Mark this migration as applied
INSERT OR IGNORE INTO migrations (name, applied_at) VALUES 
    ('0003_add_indexes_and_optimization.sql', strftime('%s', 'now'));

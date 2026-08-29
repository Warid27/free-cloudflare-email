-- Create sent_emails table to track outgoing emails
CREATE TABLE IF NOT EXISTS sent_emails (
    id TEXT PRIMARY KEY,
    address_id TEXT NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    subject TEXT,
    body_text TEXT,
    body_html TEXT,
    sent_at INTEGER NOT NULL,
    FOREIGN KEY (address_id) REFERENCES email_addresses(id) ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_sent_emails_address_id ON sent_emails(address_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_sent_at ON sent_emails(sent_at);
CREATE INDEX IF NOT EXISTS idx_sent_emails_from_address ON sent_emails(from_address);

-- Mark this migration as applied
INSERT OR IGNORE INTO migrations (name, applied_at) VALUES 
    ('0004_create_sent_emails.sql', strftime('%s', 'now'));

# Design Critique — Free Cloudflare Email System

> Focused architectural review. Not a repeat of code-level bugs (those are in PR #1).
> Written to inform a v2 rewrite or incremental structural improvement.

---

## 1. Architecture Shape

### What exists

A single Cloudflare Worker serves five distinct roles:

```
src/index.ts
  ├── Hono HTTP app      (API routes + inline HTML UI)
  ├── email() handler     (Cloudflare Email Routing)
  ├── scheduled() handler (cron cleanup)
  └── webhook endpoint    (manual email injection)
```

Everything shares one `wrangler.toml`, one `Env` type, and one D1 database binding.

### Is this right?

**For a personal/small-team tool: yes.** The single-worker pattern is idiomatic for Cloudflare Workers, keeps deployment atomic, and avoids cross-service auth. There is no reason to split this into multiple workers today.

**The problem is not the topology — it's the coupling.** The five roles share a single module graph, which creates concrete issues:

1. **`emailHandler.ts` imports `PostalMime`** (~40KB parsed). This gets bundled into the HTTP path even though it's only needed for the `email()` handler. On the free tier (10ms CPU/request), this matters for cold starts.

2. **The UI is ~2300 lines of template literals inside `src/ui.ts`**. This means every code change triggers a full worker rebuild. The HTML/CSS/JS has no tooling — no minification, no linting, no template compilation. A single typo in a template literal is a silent runtime bug.

3. **The cron handler dynamically imports `emailHandler.js`** to avoid circular deps. This is a code smell that signals the module graph has grown organically without a clear dependency boundary.

4. **D1 bindings are tightly coupled to route handlers.** Every route handler directly calls `c.env.DB.prepare(...)`. There is no data access layer, so SQL changes require touching route files and vice versa.

### What to do

The single-worker topology is fine. The internal structure needs layering:

```
src/
  ├── handlers/
  │   ├── http.ts          # Hono app, routes, middleware
  │   ├── email.ts         # Cloudflare email() entry point
  │   └── cron.ts          # Scheduled handler
  ├── db/
  │   ├── client.ts        # Thin wrapper around D1Database
  │   ├── users.ts         # User queries
  │   ├── addresses.ts     # Address queries
  │   ├── emails.ts        # Email queries
  │   └── settings.ts      # Settings queries
  ├── auth/
  │   ├── middleware.ts     # Token extraction + verification
  │   └── permissions.ts   # Ownership checks
  ├── services/
  │   ├── email-parser.ts  # PostalMime wrapper
  │   ├── email-sender.ts  # SEND_EMAIL wrapper
  │   └── sanitizer.ts     # HTML sanitization
  └── ui/                  # Keep inline, but extract to separate files
      ├── pages/
      │   ├── login.ts
      │   ├── dashboard.ts
      │   └── admin.ts
      └── shared.ts
```

**Why a DB layer matters most:** Currently, the admin inbox endpoint has raw SQL scattered across route handlers. When you add email search, tag filtering, or read receipts, each route handler will duplicate query logic. A `db/emails.ts` module with functions like `getEmailsByUser(userId, filters)`, `getEmailById(emailId, userId?)`, `getUnifiedInbox(limit, offset)` would be testable, reusable, and auditable.

---

## 2. Data Model

### Current schema (6 tables)

| Table | Rows/day (est.) | Hot path |
|-------|-----------------|----------|
| `users` | Low (1-5) | Auth check on every request |
| `email_addresses` | Low (1-5) | Address lookup on every email receive |
| `emails` | Medium (10-100) | List, detail, cleanup |
| `sent_emails` | Low-Medium (1-10) | Admin inbox, list |
| `send_permissions` | Low (1-2) | Permission check on send |
| `settings` | Very low (1/week) | Domain/TTL on every email receive |

### What's wrong

**A. Every email receive does 2 DB reads + 1 write.** The `handleIncomingEmail` path:

```
1. SELECT id FROM email_addresses WHERE address = ?     (address lookup)
2. SELECT value FROM settings WHERE key = 'email_ttl_days'  (TTL lookup)
3. INSERT INTO emails ...                                (store email)
```

Step 2 queries a settings table that changes ~once a week. This is wasting a D1 read on every single incoming email. With 100 emails/day, that's 100 unnecessary reads.

**Fix:** Cache TTL in the Worker's global scope. D1 settings change rarely — read-once, store in module-level variable, invalidate on admin PUT.

**B. The `email_addresses` table has no limit enforcement.** A user can create unlimited addresses. There's no `COUNT(*)` check, no per-user quota, and no unique constraint on `(user_id, domain)`. This is a DDoS vector via D1 storage.

**Fix:** Add a `user_settings` table or a column on `users` for per-user address quota.

**C. Index over-creation.** Migration 0003 adds composite indexes that duplicate single-column indexes from migration 0001:

```
idx_emails_address_id       (0001)
idx_emails_address_id_user  (0003) — redundant for prefix queries
```

SQLite uses leftmost-prefix matching. `idx_emails_address_id` already covers `WHERE address_id = ?`. The composite adds nothing for that pattern. It only helps if you query `WHERE address_id = ? AND user_id = ?` — but the code never does that directly (it joins through `email_addresses`).

**Fix:** Audit each index against actual query patterns. Drop redundant ones. D1 charges per read — every unused index is waste.

**D. `raw_email` column type.** The `emails` table stores `raw_email` as `TEXT`. D1's row limit is 1MB. The code truncates to 90KB, but this column is never read after insertion (no "download raw email" feature). It's 90KB of dead storage per email.

**Fix:** Either remove `raw_email` entirely, or move it to R2 (Cloudflare's object storage) which is free for 10GB. The Worker can write to R2 on receive and generate a signed URL on demand.

**E. Missing table: `email_tags` or `email_folders`.** Users can't organize emails. For a "webmail" system, the lack of any organizational primitive is a significant UX gap.

### Proposed schema additions

```sql
-- Per-user settings (address quotas, display preferences)
CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  max_addresses INTEGER DEFAULT 10,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Optional: email labels/folders for organization
CREATE TABLE email_labels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, name)
);

CREATE TABLE email_label_map (
  email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES email_labels(id) ON DELETE CASCADE,
  PRIMARY KEY (email_id, label_id)
);
```

---

## 3. Security Model

### Current model

```
User registers -> gets opaque token -> stores in localStorage ->
  sends as Bearer header -> middleware checks DB -> sets c.set('user')
```

Admin is a boolean column on the `users` table. The initial admin is created by migration with a known token.

### What's missing

**A. Token lifecycle.** Tokens never expire, never rotate, and can't be revoked. If a token leaks (browser extension, XSS, shared computer), there's no way to invalidate it except updating the DB directly.

**Concrete fix:**

```sql
CREATE TABLE auth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,  -- SHA-256 of the token
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  user_agent TEXT
);
```

Store the hash, not the raw token. Issue tokens with 30-day expiry. The middleware becomes:

```typescript
// 1. Hash the bearer token
// 2. SELECT FROM auth_tokens WHERE token_hash = ? AND expires_at > now
// 3. Update last_used_at (async, dont block request)
// 4. Join to users for the user record
```

This gives you: token expiry, revocation, audit trail, and no plaintext tokens in the DB.

**B. No per-endpoint rate limiting.** The Worker has no throttling on any endpoint. An attacker can:

- Register thousands of accounts (D1 storage fill)
- Send thousands of permission requests (spam admin)
- Create unlimited addresses (email routing abuse)

**Concrete fix:** Use Cloudflare's Rate Limiting rules on the free tier (1 rule available). Or implement in-Worker using a D1-backed counter:

```typescript
async function checkRateLimit(db: D1Database, key: string, limit: number, windowSec: number): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSec;
  const row = await db.prepare(
    'SELECT COUNT(*) as count FROM rate_limits WHERE key = ? AND created_at > ?'
  ).bind(key, windowStart).first();
  if ((row?.count ?? 0) >= limit) return false;
  await db.prepare(
    'INSERT INTO rate_limits (id, key, created_at) VALUES (?, ?, ?)'
  ).bind(crypto.randomUUID(), key, now).run();
  return true;
}
```

**C. Admin bootstrap is fragile.** The migration creates a user with `id = 'admin'` and token `admin-secret-token-change-this`. Problems:

- The token is in the SQL file (public in git)
- If you forget to change it, anyone has admin access
- The admin user ID is a hardcoded string, not a UUID
- There is no way to create a second admin without direct DB access

**Fix:** Remove the admin INSERT from migration 0001. Create a CLI script:

```bash
npm run admin:create -- --email admin@example.com
# Generates a random token, creates admin user, prints token once
```

And add an admin promotion endpoint (requires existing admin auth):

```typescript
app.post('/api/admin/promote/:userId', requireAdmin, async (c) => { ... })
```

**D. CORS misconfiguration surface.** The `CORS_ORIGINS` variable accepts a comma-separated string parsed per-request. If someone sets it to `*`, the entire API is open. There is no validation.

**Fix:** Reject `*` as a valid origin pattern. Log a warning if `CORS_ORIGINS` contains wildcards.

**E. No Content-Security-Policy on UI pages.** The inline HTML pages are served without CSP headers. Even with `sanitizeHtml()`, a CSP provides defense-in-depth:

```typescript
c.header('Content-Security-Policy',
  "default-src 'self'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com"
);
```

---

## 4. Operational Gaps

### Cron cleanup

**Current:** Runs daily at 2am UTC, deletes all emails where `expires_at < now`.

**Problems:**

1. **No batching.** D1 has a query execution time limit. If 100K emails expire on the same day, the single DELETE will time out.

2. **No observability.** The handler logs "Deleted N expired emails" but nothing else.

3. **No sent email cleanup.** The `sent_emails` table grows forever.

**Fix:**

```typescript
async function cleanupExpiredEmails(env: Env): Promise<{ deleted: number }> {
  const BATCH_SIZE = 500;
  let totalDeleted = 0;
  const now = getCurrentTimestamp();

  while (true) {
    const batch = await env.DB.prepare(
      'SELECT id FROM emails WHERE expires_at IS NOT NULL AND expires_at < ? LIMIT ?'
    ).bind(now, BATCH_SIZE).all();

    if (!batch.results || batch.results.length === 0) break;

    const ids = batch.results.map((r: any) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const result = await env.DB.prepare(
      `DELETE FROM emails WHERE id IN (${placeholders})`
    ).bind(...ids).run();

    totalDeleted += result.meta.changes;
    if (batch.results.length < BATCH_SIZE) break;
  }

  // Also cleanup old sent emails (older than 2x TTL)
  const ttlSetting = await env.DB.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).bind('email_ttl_days').first();
  const ttlDays = ttlSetting ? parseInt(ttlSetting.value) : 30;
  const sentExpiry = now - (ttlDays * 2 * 24 * 60 * 60);

  const sentCleanup = await env.DB.prepare(
    'DELETE FROM sent_emails WHERE sent_at < ?'
  ).bind(sentExpiry).run();

  return { deleted: totalDeleted + sentCleanup.meta.changes };
}
```

### Migration strategy

**Current:** Custom Node.js script (`run-migrations.js`) that parses wrangler CLI output with regex. Fragile across wrangler versions.

**Fix:** Replace with native Wrangler:

```json
{
  "scripts": {
    "migrate:local": "wrangler d1 migrations apply email-system-db",
    "migrate:remote": "wrangler d1 migrations apply email-system-db --remote",
    "migrate:prod": "wrangler d1 migrations apply email-system-db --remote --env production"
  }
}
```

Delete `scripts/run-migrations.js`.

### Monitoring

**What you need at minimum:**

1. **Structured logs** — Replace console.error with structured JSON:

```typescript
function log(level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ level, message, ...data, timestamp: new Date().toISOString() }));
}
```

2. **Health check that's actually useful** — Verify D1 connectivity:

```typescript
app.get('/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ status: 'ok', db: 'connected', timestamp: Date.now() });
  } catch {
    return c.json({ status: 'degraded', db: 'disconnected', timestamp: Date.now() }, 503);
  }
});
```

### Failure modes

| Scenario | What happens today | What should happen |
|----------|-------------------|-------------------|
| D1 is down | All requests 500 | Return 503 with Retry-After header |
| Email parsing fails | Exception thrown, email lost | Store raw in failed_emails table |
| Cron timeout | Emails not cleaned up | Batch the deletion |
| Admin deletes domain setting | New addresses use fallback | Validate domain is a real FQDN |
| User creates 1000 addresses | D1 storage fills | Enforce per-user address quota |

---

## 5. API Design

### Inconsistencies

**A. Response format is inconsistent.**

Some endpoints return `{ "success": true, "users": [...] }`.
Others return `{ "count": 0 }` without `success`.

**Fix:** Standardize on a consistent envelope:

```typescript
type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code: string };
```

**B. Route naming mixes conventions.**

```
GET  /api/emails/address/:addressId    # nested resource via path
GET  /api/emails?address_id=X          # same thing via query param
POST /api/emails/address/:id/request-send  # action on nested resource
POST /api/emails/send                  # action without nesting
```

**Fix:** Pick one pattern:

```
GET    /api/addresses/:id/emails       # emails for an address
GET    /api/emails                      # all user's emails (with filters)
POST   /api/addresses/:id/send         # send from this address
POST   /api/addresses/:id/request-send # request permission
```

**C. Admin endpoints leak into user namespace.** `GET /api/emails/:emailId` returns different data based on `is_admin`. Same endpoint, different behavior based on a flag.

**Fix:** Separate admin namespace consistently:

```
GET /api/emails/:id          # only own emails
GET /api/admin/emails/:id    # any email
```

**D. The `count_only` query parameter is a hack.** Returns `{ count: 5 }` — a completely different response shape.

**Fix:** Always include total in pagination:

```json
{
  "success": true,
  "emails": [],
  "pagination": { "total": 42, "limit": 50, "offset": 0, "has_more": false }
}
```

### Missing endpoints

| Endpoint | Why it's needed |
|----------|----------------|
| `GET /api/user/me/tokens` | List active sessions |
| `DELETE /api/user/me/tokens/:tokenId` | Revoke a specific token |
| `GET /api/addresses/:id/stats` | Email count, last received |
| `GET /api/emails/search?q=` | Search by subject/sender |
| `POST /api/admin/users/:id/promote` | Make a user admin |
| `GET /api/admin/storage` | D1 storage usage |

---

## 6. Redesign Proposals

### Proposal A: Data Access Layer

**Problem:** SQL scattered across route handlers. No reuse, no testability.

**Fix:** Create `src/db/` modules:

```typescript
// src/db/emails.ts
export class EmailRepository {
  constructor(private db: D1Database) {}

  async findById(emailId: string, userId?: string): Promise<Email | null> {
    if (userId) {
      return this.db.prepare(`
        SELECT e.* FROM emails e
        INNER JOIN email_addresses ea ON e.address_id = ea.id
        WHERE e.id = ? AND ea.user_id = ?
      `).bind(emailId, userId).first<Email>();
    }
    return this.db.prepare('SELECT * FROM emails WHERE id = ?')
      .bind(emailId).first<Email>();
  }

  async listByUser(userId: string, opts: { limit: number; offset: number; addressId?: string }) {
    // ... query logic
  }

  async countByUser(userId: string): Promise<number> {
    // ...
  }
}
```

### Proposal B: Settings Cache

**Problem:** Settings query on every incoming email. Settings change once a week.

**Fix:**

```typescript
const cache = new Map<string, { value: string; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.value;

  const row = await db.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key).first();
  if (row) {
    cache.set(key, { value: row.value, fetchedAt: Date.now() });
    return row.value;
  }
  return null;
}
```

### Proposal C: Token System Redesign

**Problem:** Single opaque token, no expiry, no revocation.

**Fix:** Session-based tokens with hash storage:

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  user_agent TEXT
);
```

### Proposal D: Email Delivery Pipeline

**Problem:** `handleIncomingEmail` is a monolith. Parse failure = email lost. D1 slow = email handler timeout.

**Fix:** Queue-based:

```typescript
// Cloudflare Email Handler — just queue
export async function onEmail(message: ForwardableEmailMessage, env: Env) {
  const rawBuffer = await streamToBuffer(message.raw);
  await env.DB.prepare(`
    INSERT INTO email_queue (id, to_address, from_address, raw_email, received_at, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).bind(crypto.randomUUID(), message.to, message.from, rawBuffer, getCurrentTimestamp()).run();
}

// Cron — process queue in batches
export async function processEmailQueue(env: Env) {
  const pending = await env.DB.prepare(
    'SELECT * FROM email_queue WHERE status = ? LIMIT 50'
  ).bind('pending').all();
  // ... parse, store, mark done
}
```

### Proposal E: Move raw_email to R2

**Problem:** 90KB per email in D1. Never read after insert. D1 free tier is 5GB.

**Fix:**

```toml
# wrangler.toml
[[r2_buckets]]
binding = "R2"
bucket_name = "email-raw"
```

```typescript
await env.R2.put(`raw/${emailId}.eml`, rawBuffer);
await db.prepare('INSERT INTO emails (..., raw_email_path) VALUES (..., ?)')
  .bind(emailId, `raw/${emailId}.eml`).run();
```

### Proposal F: Split UI from Worker

**Problem:** 2300 lines of template literals. No tooling.

**Fix:** Extract to `.html` files in `public/`, serve as Workers Assets. Same SPA approach, proper HTML files.

---

## Priority Matrix

| Proposal | Impact | Effort | Do first? |
|----------|--------|--------|-----------|
| **B: Settings cache** | Eliminates 1 read/email | 30 min | Yes |
| **D: Email delivery queue** | Prevents data loss | 2-3 hours | Yes |
| **A: Data access layer** | Testability + reuse | 3-4 hours | Yes |
| **C: Token system** | Security baseline | 2-3 hours | Next |
| **F: Split UI** | Developer experience | 4-6 hours | Next |
| **E: R2 for raw email** | D1 storage savings | 1-2 hours | When needed |

---

## TL;DR

The system works and is cleverly built for $0/month. The main architectural risks are:

1. **No data access layer** — SQL everywhere makes the codebase fragile
2. **No token lifecycle** — leaked tokens can't be revoked
3. **Email receive path does unnecessary work** — settings lookup on every email
4. **Raw email in D1** — burns storage fast, should go to R2
5. **Inline UI** — 2300 lines of template literals with no tooling
6. **No email queue** — parse failures lose emails silently

None of these require a rewrite. Each can be addressed incrementally, starting with the settings cache and data access layer (highest impact, lowest effort).

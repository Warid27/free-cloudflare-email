# Free Cloudflare Email System — Context Document

## Overview

A complete email management system built entirely on Cloudflare's free tier. Create unlimited email addresses on your custom domain with a modern Japandi-themed web interface and full admin controls.

**Live URL:** https://free-cloudflare-email.myduit.workers.dev
**Domain:** al-warid.web.id
**Stack:** Cloudflare Workers + D1 Database + Email Routing
**Cost:** $0/month
**UI Design:** Japandi (warm neutrals, sage/brass accents, minimal aesthetics)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Cloudflare Worker                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  Hono App   │  │  Email      │  │  Cron       │    │
│  │  (fetch)    │  │  Handler    │  │  Trigger    │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
│         │                │                │             │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐    │
│  │  API Routes │  │  Email      │  │  Cleanup    │    │
│  │  + UI Pages │  │  Routing    │  │  Expired    │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
│         │                │                │             │
│  ┌──────▼────────────────▼────────────────▼──────┐    │
│  │              D1 Database (email-system-db)      │    │
│  └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Cloudflare Workers |
| Framework | Hono |
| Database | Cloudflare D1 |
| Email Parsing | postal-mime |
| Language | TypeScript |
| Build Tool | Wrangler |
| UI | Inline HTML/CSS/JS (Japandi design system, served via Worker) |
| Fonts | Inter + Noto Sans JP (Google Fonts) |

---

## Project Structure

```
free-cloudflare-email/
├── src/
│   ├── index.ts              # Main app entry, route mounting, cron handler
│   ├── types.ts              # TypeScript interfaces (Env, User, Email, etc.)
│   ├── middleware.ts          # Auth middleware (requireAuth, requireAdmin, ownership checks)
│   ├── utils.ts              # Helper functions (UUID, token, email formatting)
│   ├── ui.ts                 # Full UI (Login, Dashboard, Admin pages - inline HTML, Japandi theme)
│   ├── emailHandler.ts       # Email parsing (postal-mime), storage, cleanup
│   └── routes/
│       ├── user.ts           # User registration, profile, deletion
│       ├── emailAddress.ts   # Address CRUD, send permission requests
│       ├── email.ts          # Email list, detail, delete, send (+ saves sent emails to DB)
│       └── admin.ts          # Admin: stats, users, settings, permissions, bulk generate, inbox, sent-emails
├── migrations/
│   ├── 0001_initial_schema.sql
│   ├── 0002_add_email_read_status.sql
│   ├── 0003_add_indexes_and_optimization.sql
│   └── 0004_create_sent_emails.sql
├── scripts/
│   ├── setup.js              # Automated setup script
│   └── run-migrations.js     # Migration runner
├── wrangler.toml             # Cloudflare Worker config
├── package.json
└── tsconfig.json
```

---

## Design System (Japandi Theme)

### Color Palette
| Token | Value | Usage |
|-------|-------|-------|
| `--jp-bg` | `#F7F3EE` | Page background |
| `--jp-surface` | `#FDFCFB` | Card backgrounds |
| `--jp-text` | `#2B2520` | Primary text |
| `--jp-text-secondary` | `#7A7168` | Secondary text |
| `--jp-accent` | `#8B7355` | Primary buttons, links |
| `--jp-sage` | `#7C8C6E` | Success states, sent badges |
| `--jp-brass` | `#B89B6A` | Received badges |
| `--jp-terracotta` | `#C17B5C` | Warm accent |
| `--jp-danger` | `#B85C5C` | Delete, error states |
| `--jp-border` | `#E5DDD4` | Borders |

### Key Design Tokens
- **Border radius:** 10px (standard), 16px (large)
- **Shadows:** Subtle warm-toned (`rgba(43, 37, 32, ...)`)
- **Transitions:** `0.2s cubic-bezier(0.4, 0, 0.2, 1)`
- **Admin sidebar:** Dark warm (`#2B2520`) with hover/active states

---

## Database Schema

### Tables

| Table | Description |
|-------|-------------|
| `users` | User accounts (id, token, is_admin, is_banned) |
| `email_addresses` | Email addresses linked to users |
| `emails` | Received emails with full content |
| `sent_emails` | Outgoing emails sent by users (tracked for admin visibility) |
| `send_permissions` | Permission requests for sending emails |
| `settings` | System settings (domain, TTL) |

### Key Relationships

```
users 1──N email_addresses 1──N emails
users 1──N email_addresses 1──N sent_emails
users 1──N send_permissions ──N email_addresses
```

---

## API Endpoints

### User Routes (`/api/user`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/register` | Create new account, returns token |
| GET | `/me` | Get current user profile |
| DELETE | `/me` | Delete account |

### Address Routes (`/api/addresses`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List user's addresses |
| POST | `/` | Create new address (body: `{prefix}`) |
| DELETE | `/:id` | Delete address |

### Email Routes (`/api/emails`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List emails (supports `address_id`, `count_only`, `limit`, `offset`) |
| GET | `/:emailId` | Get email detail (admin can view any email) |
| DELETE | `/:emailId` | Delete email |
| GET | `/address/:addressId` | List emails for specific address |
| POST | `/address/:addressId/request-send` | Request send permission |
| POST | `/send` | Send email (requires approved permission, **saves to sent_emails**) |
| POST | `/:emailId/mark-read` | Mark email as read |
| POST | `/:emailId/mark-unread` | Mark email as unread |

### Admin Routes (`/api/admin`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/stats` | Dashboard statistics |
| GET | `/users` | List all users |
| POST | `/users/:userId/ban` | Ban user |
| POST | `/users/:userId/unban` | Unban user |
| DELETE | `/users/:userId` | Delete user |
| GET | `/emails` | List all received emails |
| GET | `/sent-emails` | List all sent emails |
| GET | `/sent-emails/:emailId` | Get sent email detail |
| GET | `/inbox` | **Unified timeline** — received + sent emails merged by timestamp |
| POST | `/addresses/generate` | Bulk generate random addresses (max 50) |
| GET | `/addresses` | List all addresses |
| GET | `/settings/ttl` | Get TTL setting |
| PUT | `/settings/ttl` | Update TTL (body: `{ttl_days}`) |
| GET | `/settings/domain` | Get domain setting |
| PUT | `/settings/domain` | Update domain (body: `{domain}`) |
| GET | `/permissions/pending` | List pending send permissions |
| POST | `/permissions/:permissionId/approve` | Approve permission |
| POST | `/permissions/:permissionId/reject` | Reject permission |

### Other Routes
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/webhook/email` | Email webhook (for testing) |
| GET | `/` | Serve login/dashboard/admin UI |
| GET | `/*` | Catch-all for UI routing |

---

## Authentication

- **Token-based:** Users authenticate via `Authorization: Bearer <token>` header
- **Admin detection:** `is_admin = 1` in users table
- **Middleware chain:** `authenticateUser` → `requireAuth` → `requireAdmin`
- **Ownership verification:** `verifyAddressOwnership`, `verifyEmailOwnership`, `verifyAddressStringOwnership`

---

## UI Pages

| Path | Page | Auth Required | Design |
|------|------|---------------|--------|
| `/` or `/login` | Login/Register | No | Japandi + glass cards + orb animations |
| `/dashboard` | User Dashboard | Yes (user) | Japandi sidebar layout |
| `/admin` | Admin Panel | Yes (admin) | Japandi dark sidebar |

### User Dashboard Features
- Address management (create, delete)
- Email inbox with address filter
- Email detail modal
- Send email (with approved permission)
- Auto-refresh (10s interval)
- Mobile responsive with bottom nav
- Section state persistence (localStorage)

### Admin Panel Features
- **Overview stats** (users, addresses, emails, pending permissions)
- **Unified Inbox** — received + sent emails merged by timestamp with direction badges
  - Received emails: brass/gold badge, standard row
  - Sent emails: sage/green badge, tinted row background
  - Click to view email detail in modal (label dynamically shows Received/Sent)
- **User management** (list, ban/unban, delete)
- **Send permission management** (approve/reject)
- **Settings** (TTL, domain)
- **Bulk address generator** (max 50 per request)
- Mobile responsive with hamburger menu + overlay

---

## Email Flow

1. **Incoming:** Cloudflare Email Routing → Worker `email()` handler → `handleIncomingEmail()` → Parse with postal-mime → Store in `emails` table
2. **Outgoing:** User requests permission → Admin approves → User sends via API → Cloudflare SendEmail binding → **Saved to `sent_emails` table** (for admin visibility)
3. **Cleanup:** Cron trigger (daily at 2am) → `cleanupExpiredEmails()` → Delete emails past TTL

---

## Key Functions (src/utils.ts)

| Function | Description |
|----------|-------------|
| `generateRandomEmailPrefix()` | Generate random 12-char alphanumeric string |
| `generateUUID()` | Generate UUID v4 |
| `generateToken()` | Generate 32-byte hex token |
| `getCurrentTimestamp()` | Unix timestamp in seconds |
| `calculateExpirationTimestamp(ttlDays)` | Future timestamp for email expiry |
| `isValidEmail(email)` | Validate email format |
| `isValidEmailPrefix(prefix)` | Validate address prefix (alphanumeric, dots, hyphens) |
| `formatEmailForResponse(email)` | Format email for API response |
| `formatUserForResponse(user)` | Format user for API response |

## Key Functions (src/middleware.ts)

| Function | Description |
|----------|-------------|
| `authenticateUser(c)` | Extract and verify user from Bearer token |
| `requireAuth(c, next)` | Middleware: require authenticated user |
| `requireAdmin(c, next)` | Middleware: require admin user |
| `verifyAddressOwnership(db, addressId, userId)` | Check address belongs to user |
| `verifyAddressStringOwnership(db, address, userId)` | Check address string belongs to user |
| `verifyEmailOwnership(db, emailId, userId)` | Check email belongs to user |

## Key UI Functions (src/ui.ts)

| Function | Description |
|----------|-------------|
| `getSharedHead(title)` | Shared meta tags, fonts, and CSS variables (login/dashboard) |
| `getAdminHead(title)` | Lightweight head for admin (meta + fonts only, no CSS) |
| `getLoginPage()` | Login/Register page with tab switching |
| `getDashboardPage()` | User dashboard with sidebar layout |
| `getAdminPage()` | Admin panel with Japandi dark sidebar |

---

## Environment Variables & Secrets

| Variable | Location | Description |
|----------|----------|-------------|
| `DB` | wrangler.toml binding | D1 Database |
| `SEND_EMAIL` | wrangler.toml binding | Cloudflare SendEmail |
| `ENVIRONMENT` | wrangler.toml vars | "development" |
| `ADMIN_TOKEN` | Cloudflare Secret | Admin authentication token |

### Cloudflare Secrets
```bash
wrangler secret put ADMIN_TOKEN
```

---

## Deployment

### Commands
```bash
npm install                    # Install dependencies
npm run dev                    # Local development
npx wrangler deploy            # Deploy to production
npm run setup                  # Automated setup
npx wrangler d1 execute email-system-db --remote --file="migrations/XXXX_name.sql"  # Run specific migration
```

### Database Queries
```bash
# List users
npx wrangler d1 execute email-system-db --remote --command="SELECT * FROM users"

# List emails
npx wrangler d1 execute email-system-db --remote --command="SELECT * FROM emails LIMIT 10"

# List sent emails
npx wrangler d1 execute email-system-db --remote --command="SELECT * FROM sent_emails LIMIT 10"

# Check admin token
npx wrangler d1 execute email-system-db --remote --command="SELECT id, token FROM users WHERE is_admin = 1"
```

---

## Domain Configuration

- **Domain:** al-warid.web.id
- **Email Routing:** Enabled via Cloudflare Dashboard
- **Catch-all:** Forward all emails to worker
- **MX Records:** Cloudflare Email Routing

---

## Known Issues & TODOs

1. **No pagination** on admin inbox table (loads up to 100 at a time)
2. **No email search** functionality
3. **No email forwarding** between addresses
4. **Bulk generate button** — addresses created with `user_id = 'admin'` (unassigned)
5. **switchSection uses event.currentTarget** — relies on global `event` object (works but fragile)
6. **User dashboard** — no sent emails section yet (only admin can see sent emails)

---

## Recent Changes

1. **Japandi UI Redesign** — Complete visual overhaul of Login, Dashboard, and Admin pages
2. **Admin getAdminHead()** — Lightweight function replacing getSharedHead() for admin (~200 lines of CSS removed)
3. **Sent Emails Tracking** — `sent_emails` table stores outgoing emails; send endpoint saves after delivery
4. **Admin Unified Inbox** — Single "Inbox" view merging received + sent emails with direction badges
5. **Admin User Column** — Emails table shows address owner (user_id)
6. **Dynamic Modal Labels** — Email detail modal shows "Received" or "Sent" based on email type
7. Fixed total emails count
8. Re-added admin panel functionalities
9. Fix filter persistence visual glitch and restore auto-refresh
10. Added state persistence and auto refresh

---

## Development Notes

- **No .env file:** All secrets stored in Cloudflare (ADMIN_TOKEN is a secret, not in wrangler.toml)
- **Inline UI:** All HTML/CSS/JS served from TypeScript files (no static assets)
- **Token auth:** Users authenticate with token from registration, admin has separate token
- **Admin user ID:** "admin" (literal string, not UUID)
- **Bulk generate:** Creates addresses with `user_id = 'admin'` (unassigned), max 50 per request
- **Sent emails:** Saved to DB with graceful error handling (send succeeds even if DB save fails)

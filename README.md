# 📧 Free Cloudflare Email System

A complete email management system built entirely on Cloudflare's free tier. Create unlimited email addresses on your custom domain with a modern web interface and full admin controls.

**Built with:** Cloudflare Workers + D1 Database + Email Routing • **Cost:** $0/month

## Features

- **Custom/Random Email Addresses** - `name@domain.com` or `abc123@domain.com`
- **Receive & Send Emails** - Full functionality (sending requires admin approval)
- **Modern Web UI** - User dashboard + admin panel
- **Token Authentication** - Secure access
- **Admin Controls** - User management, permissions, TTL settings
- **Auto-Cleanup** - Configurable email expiration

## Quick Setup

### 1. Install & Configure

```bash
npm install
npm install -g wrangler
wrangler login
```

### 2. Automated Setup (Recommended)

```bash
npm run setup
```

This will guide you through:
- Creating the D1 database
- Running all migrations
- Configuring admin token
- Deploying to Workers
- Setting up email routing

### 3. Manual Setup (Alternative)

If you prefer manual setup:

```bash
# Create database
wrangler d1 create email-system-db

# Update wrangler.toml with the database_id from above

# Run all migrations automatically
npm run migrate

# Deploy
wrangler deploy
```

## Usage

**Register:** Click Register → Create Account → Save token  
**Create Address:** Login → My Addresses → Enter prefix or leave empty  
**Read Emails:** Inbox tab → Select address → Click email  
**Send Emails:** Request permission → Wait for admin approval → Send  
**Admin:** Login with admin token for full management

## API Endpoints

```bash
# User
POST   /api/user/register
GET    /api/user/me
DELETE /api/user/me

# Addresses
POST   /api/addresses/              # Body: {"prefix": "name"} or {}
GET    /api/addresses/
DELETE /api/addresses/:id

# Emails
GET    /api/emails?address_id=&count_only=&limit=&offset=
GET    /api/emails/address/:id
GET    /api/emails/:id
DELETE /api/emails/:id
POST   /api/emails/address/:id/request-send
POST   /api/emails/send             # Body: {from, to, subject, text}
POST   /api/emails/:id/mark-read
POST   /api/emails/:id/mark-unread

# Admin (requires admin token)
GET    /api/admin/stats
GET    /api/admin/users
POST   /api/admin/users/:id/ban
POST   /api/admin/users/:id/unban
DELETE /api/admin/users/:id
GET    /api/admin/emails
GET    /api/admin/sent-emails
GET    /api/admin/sent-emails/:id
GET    /api/admin/inbox
GET    /api/admin/addresses
POST   /api/admin/addresses/generate  # Body: {"count": 5, "prefix": "test"}
GET    /api/admin/permissions/pending
POST   /api/admin/permissions/:id/approve
POST   /api/admin/permissions/:id/reject
GET    /api/admin/settings/ttl
PUT    /api/admin/settings/ttl       # Body: {"ttl_days": 30}
GET    /api/admin/settings/domain
PUT    /api/admin/settings/domain    # Body: {"domain": "example.com"}

# Other
GET    /health                       # Health check
POST   /webhook/email                # Email webhook (optional auth)
```

**Authentication:** `Authorization: Bearer YOUR_TOKEN`

**Example:**
```bash
curl -X POST https://your-worker.workers.dev/api/addresses/ \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prefix": "john"}'
```

## CI/CD (GitHub Actions)

This project includes automated CI and deployment via GitHub Actions:

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| CI | Push/PR to `main` | TypeScript type check + build verification |
| Deploy | Push to `main` | Runs migrations + deploys to Cloudflare Workers |

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | API token with Workers/D1 permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

See [DEPLOYMENT.md](DEPLOYMENT.md) for full setup instructions.

## Development

```bash
npm run dev              # Local development
wrangler tail            # View logs
wrangler d1 execute email-system-db --remote --command="SELECT * FROM users"
```

## Troubleshooting

- **Emails not receiving:** Check Email Routing enabled, catch-all configured
- **Can't login:** Verify admin token, clear browser cache
- **TypeScript errors:** Run `npm install`
- **Database errors:** Check database_id in wrangler.toml

## License

MIT

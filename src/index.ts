import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, Variables } from './types';
import { requireAuth, requireAdmin } from './middleware';
import { userRoutes } from './routes/user.js';
import { emailAddressRoutes } from './routes/emailAddress.js';
import { emailRoutes } from './routes/email.js';
import { adminRoutes } from './routes/admin.js';
import { handleIncomingEmail } from './emailHandler.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Global error handler
app.onError((err, c) => {
  console.error(`[ERROR] ${c.req.method} ${c.req.path}:`, err);
  return c.json({ error: 'Internal server error' }, 500);
});

// CORS middleware
app.use('/*', cors({
  origin: (origin, c) => {
    const env = c.env as Env;
    const allowed = env.CORS_ORIGINS?.split(',').map(s => s.trim()) || [];
    // Allow requests with no origin (e.g. curl, mobile apps)
    if (!origin) return origin;
    if (allowed.includes(origin)) return origin;
    // Check wildcard patterns
    for (const pattern of allowed) {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        if (regex.test(origin)) return origin;
      }
    }
    return '';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

// Email webhook handler
app.post('/webhook/email', async (c) => {
  try {
    await handleIncomingEmail(c);
    return c.json({ success: true });
  } catch (error) {
    console.error('Email webhook error:', error);
    return c.json({ error: 'Failed to process email' }, 500);
  }
});

// API routes
app.route('/api/user', userRoutes);
app.route('/api/user/', userRoutes);
app.route('/api/addresses', emailAddressRoutes);
app.route('/api/addresses/', emailAddressRoutes);
app.route('/api/emails', emailRoutes);
app.route('/api/emails/', emailRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/admin/', adminRoutes);

// Email handler for Cloudflare Email Routing
async function email(message: any, env: Env, ctx: ExecutionContext): Promise<void> {
  try {
    await handleIncomingEmail({ env, message });
  } catch (error) {
    console.error('Email handler error:', error);
  }
}

export default {
  fetch: app.fetch,
  email,
  // Cloudflare Cron Trigger handler
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Import cleanupExpiredEmails dynamically to avoid circular deps
    const mod = await import('./emailHandler.js');
    const deleted = await mod.cleanupExpiredEmails(env);
    if (deleted > 0) {
      console.log(`[CRON] Deleted ${deleted} expired emails.`);
    } else {
      console.log('[CRON] No expired emails to delete.');
    }
  },
};

import { Hono } from 'hono';
import { Env, Variables } from '../types';
import { getCurrentTimestamp, formatUserForResponse, generateUUID, generateRandomEmailPrefix } from '../utils';
import { sanitizeHtml } from '../sanitizer';
import { requireAdmin } from '../middleware';
import { errorResponse, successResponse } from '../helpers';
import { getSettingWithDefault, invalidateCache } from '../settings-cache';
import { deleteUser, updateSetting, getAddressByString, createAddress } from '../db';

export const adminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Get all users
adminRoutes.get('/users', requireAdmin, async (c) => {
  try {
    const users = await c.env.DB.prepare(
      'SELECT id, is_admin, is_banned, created_at FROM users ORDER BY created_at DESC'
    ).all();

    return c.json(successResponse({ users: users.results }));
  } catch (error) {
    return c.json(errorResponse('Failed to fetch users', 500));
  }
});

// Ban a user
adminRoutes.post('/users/:userId/ban', requireAdmin, async (c) => {
  const userId = c.req.param('userId');
  const now = getCurrentTimestamp();

  try {
    await c.env.DB.prepare(
      'UPDATE users SET is_banned = 1, updated_at = ? WHERE id = ?'
    ).bind(now, userId).run();

    return c.json(successResponse({ message: 'User banned' }));
  } catch (error) {
    return c.json(errorResponse('Failed to ban user', 500));
  }
});

// Unban a user
adminRoutes.post('/users/:userId/unban', requireAdmin, async (c) => {
  const userId = c.req.param('userId');
  const now = getCurrentTimestamp();

  try {
    await c.env.DB.prepare(
      'UPDATE users SET is_banned = 0, updated_at = ? WHERE id = ?'
    ).bind(now, userId).run();

    return c.json(successResponse({ message: 'User unbanned' }));
  } catch (error) {
    return c.json(errorResponse('Failed to unban user', 500));
  }
});

// Delete a user (cascade: emails → sent_emails → permissions → addresses → user)
adminRoutes.delete('/users/:userId', requireAdmin, async (c) => {
  const userId = c.req.param('userId');

  try {
    await deleteUser(c.env.DB, userId);
    return c.json(successResponse({ message: 'User deleted' }));
  } catch (error) {
    return c.json(errorResponse('Failed to delete user', 500));
  }
});

// Get all emails (admin view)
adminRoutes.get('/emails', requireAdmin, async (c) => {
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = parseInt(c.req.query('offset') || '0');

  try {
    const emails = await c.env.DB.prepare(
      `SELECT e.id, e.from_address, e.to_address, e.subject, e.received_at, ea.user_id
       FROM emails e
       INNER JOIN email_addresses ea ON e.address_id = ea.id
       ORDER BY e.received_at DESC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all();

    return c.json(successResponse({ emails: emails.results }));
  } catch (error) {
    return c.json(errorResponse('Failed to fetch emails', 500));
  }
});

// Bulk generate random email addresses
adminRoutes.post('/addresses/generate', requireAdmin, async (c) => {
  const body = await c.req.json();
  const { count = 1, prefix } = body;

  if (count < 1 || count > 50) {
    return c.json(errorResponse('Count must be between 1 and 50', 400));
  }

  try {
    const domain = await getSettingWithDefault(c.env.DB, 'domain', 'al-warid.web.id');

    const now = getCurrentTimestamp();
    const generated: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < count; i++) {
      try {
        const addressPrefix = prefix ? `${prefix}-${i + 1}` : generateRandomEmailPrefix();
        const emailAddress = `${addressPrefix}@${domain}`;
        const addressId = generateUUID();

        // Check for duplicates
        const existing = await getAddressByString(c.env.DB, emailAddress);

        if (existing) {
          errors.push(`${emailAddress} already exists`);
          continue;
        }

        // Create with admin as user_id (unassigned)
        await createAddress(c.env.DB, addressId, 'admin', emailAddress, now);

        generated.push(emailAddress);
      } catch (err) {
        errors.push(`Failed to create address #${i + 1}`);
      }
    }

    return c.json(successResponse({
      generated,
      errors,
      count: generated.length,
    }));
  } catch (error) {
    return c.json(errorResponse('Failed to generate addresses', 500));
  }
});

// Get all email addresses
adminRoutes.get('/addresses', requireAdmin, async (c) => {
  try {
    const addresses = await c.env.DB.prepare(
      'SELECT id, user_id, address, created_at FROM email_addresses ORDER BY created_at DESC'
    ).all();

    return c.json(successResponse({ addresses: addresses.results }));
  } catch (error) {
    return c.json(errorResponse('Failed to fetch email addresses', 500));
  }
});

// Get email TTL setting
adminRoutes.get('/settings/ttl', requireAdmin, async (c) => {
  try {
    const ttlDays = await getSettingWithDefault(c.env.DB, 'email_ttl_days', '30');
    return c.json(successResponse({ ttl_days: ttlDays }));
  } catch (error) {
    return c.json(errorResponse('Failed to fetch TTL setting', 500));
  }
});

// Update email TTL setting
adminRoutes.put('/settings/ttl', requireAdmin, async (c) => {
  const body = await c.req.json();
  const { ttl_days } = body;

  if (!ttl_days || isNaN(parseInt(ttl_days))) {
    return c.json(errorResponse('Invalid TTL value', 400));
  }

  try {
    const now = getCurrentTimestamp();
    await updateSetting(c.env.DB, 'email_ttl_days', ttl_days.toString(), now);
    invalidateCache('email_ttl_days');

    return c.json(successResponse({ ttl_days: ttl_days }));
  } catch (error) {
    return c.json(errorResponse('Failed to update TTL setting', 500));
  }
});

// Get domain setting
adminRoutes.get('/settings/domain', requireAdmin, async (c) => {
  try {
    const domain = await getSettingWithDefault(c.env.DB, 'domain', 'your-domain.com');
    return c.json(successResponse({ domain }));
  } catch (error) {
    return c.json(errorResponse('Failed to fetch domain setting', 500));
  }
});

// Update domain setting
adminRoutes.put('/settings/domain', requireAdmin, async (c) => {
  const body = await c.req.json();
  const { domain } = body;

  if (!domain) {
    return c.json(errorResponse('Domain is required', 400));
  }

  try {
    const now = getCurrentTimestamp();
    await updateSetting(c.env.DB, 'domain', domain, now);
    invalidateCache('domain');

    return c.json(successResponse({ domain: domain }));
  } catch (error) {
    return c.json(errorResponse('Failed to update domain setting', 500));
  }
});

// Get pending send permission requests
adminRoutes.get('/permissions/pending', requireAdmin, async (c) => {
  try {
    const permissions = await c.env.DB.prepare(
      `SELECT sp.id, sp.address_id, sp.status, sp.requested_at, ea.address, ea.user_id
       FROM send_permissions sp
       INNER JOIN email_addresses ea ON sp.address_id = ea.id
       WHERE sp.status = 'pending'
       ORDER BY sp.requested_at DESC`
    ).all();

    return c.json(successResponse({ permissions: permissions.results }));
  } catch (error) {
    return c.json(errorResponse('Failed to fetch pending permissions', 500));
  }
});

// Approve send permission
adminRoutes.post('/permissions/:permissionId/approve', requireAdmin, async (c) => {
  const permissionId = c.req.param('permissionId');
  const admin = c.get('user');
  const now = getCurrentTimestamp();

  try {
    await c.env.DB.prepare(
      'UPDATE send_permissions SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?'
    ).bind('approved', now, admin.id, permissionId).run();

    return c.json(successResponse({ message: 'Permission approved' }));
  } catch (error) {
    return c.json(errorResponse('Failed to approve permission', 500));
  }
});

// Reject send permission
adminRoutes.post('/permissions/:permissionId/reject', requireAdmin, async (c) => {
  const permissionId = c.req.param('permissionId');
  const admin = c.get('user');
  const now = getCurrentTimestamp();

  try {
    await c.env.DB.prepare(
      'UPDATE send_permissions SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?'
    ).bind('rejected', now, admin.id, permissionId).run();

    return c.json(successResponse({ message: 'Permission rejected' }));
  } catch (error) {
    return c.json(errorResponse('Failed to reject permission', 500));
  }
});

// Get all sent emails (admin view)
adminRoutes.get('/sent-emails', requireAdmin, async (c) => {
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = parseInt(c.req.query('offset') || '0');

  try {
    const emails = await c.env.DB.prepare(
      `SELECT se.id, se.from_address, se.to_address, se.subject, se.sent_at, ea.user_id
       FROM sent_emails se
       INNER JOIN email_addresses ea ON se.address_id = ea.id
       ORDER BY se.sent_at DESC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all();

    return c.json(successResponse({ emails: emails.results }));
  } catch (error) {
    return c.json(errorResponse('Failed to fetch sent emails', 500));
  }
});

// Get a specific sent email by ID (admin view)
adminRoutes.get('/sent-emails/:emailId', requireAdmin, async (c) => {
  const emailId = c.req.param('emailId');

  try {
    const email = await c.env.DB.prepare(
      `SELECT se.*, ea.user_id
       FROM sent_emails se
       INNER JOIN email_addresses ea ON se.address_id = ea.id
       WHERE se.id = ?`
    ).bind(emailId).first();

    if (!email) {
      return c.json(errorResponse('Sent email not found', 404));
    }

    // Sanitize HTML body to prevent XSS
    const sanitized = {
      ...email,
      body_html: sanitizeHtml(email.body_html as string | null),
    };

    return c.json(successResponse({ email: sanitized }));
  } catch (error) {
    return c.json(errorResponse('Failed to fetch sent email', 500));
  }
});

// Get unified inbox (received + sent emails merged by timestamp)
adminRoutes.get('/inbox', requireAdmin, async (c) => {
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = parseInt(c.req.query('offset') || '0');

  try {
    // Use UNION to get a properly interleaved timeline with correct pagination
    const all = await c.env.DB.prepare(
      `(
        SELECT e.id, e.from_address, e.to_address, e.subject, e.received_at as timestamp, ea.user_id, 'received' as direction
        FROM emails e
        INNER JOIN email_addresses ea ON e.address_id = ea.id
      )
      UNION ALL
      (
        SELECT se.id, se.from_address, se.to_address, se.subject, se.sent_at as timestamp, ea.user_id, 'sent' as direction
        FROM sent_emails se
        INNER JOIN email_addresses ea ON se.address_id = ea.id
      )
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?`
    ).bind(limit, offset).all();

    return c.json(successResponse({ emails: all.results || [] }));
  } catch (error) {
    console.error('Failed to fetch inbox:', error);
    return c.json(errorResponse('Failed to fetch inbox', 500));
  }
});

// Get system statistics
adminRoutes.get('/stats', requireAdmin, async (c) => {
  try {
    const userCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first();
    const addressCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM email_addresses').first();
    const emailCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM emails').first();
    const pendingPermissions = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM send_permissions WHERE status = 'pending'"
    ).first();

    return c.json(successResponse({
      users: (userCount as any)?.count || 0,
      addresses: (addressCount as any)?.count || 0,
      emails: (emailCount as any)?.count || 0,
      pending_permissions: (pendingPermissions as any)?.count || 0,
    }));
  } catch (error) {
    return c.json(errorResponse('Failed to fetch statistics', 500));
  }
});

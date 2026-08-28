import { Hono } from 'hono';
import { Env, Variables } from '../types';
import { generateToken, generateUUID, getCurrentTimestamp, formatUserForResponse, generateRandomEmailPrefix } from '../utils';
import { requireAuth } from '../middleware';
import { errorResponse, successResponse } from '../helpers';

export const userRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Register a new user
userRoutes.post('/register', async (c) => {
  try {
    const userId = generateUUID();
    const token = generateToken();
    const now = getCurrentTimestamp();

    await c.env.DB.prepare(
      'INSERT INTO users (id, token, is_admin, is_banned, created_at, updated_at) VALUES (?, ?, 0, 0, ?, ?)'
    ).bind(userId, token, now, now).run();

    // Auto-create an email address for the new user
    let autoCreatedAddress = null;
    try {
      const domainSetting = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?')
        .bind('domain')
        .first<{ value: string }>();
      const domain = domainSetting?.value || 'al-warid.web.id';
      const prefix = generateRandomEmailPrefix();
      const emailAddress = `${prefix}@${domain}`;
      const addressId = generateUUID();

      await c.env.DB.prepare(
        'INSERT INTO email_addresses (id, user_id, address, created_at) VALUES (?, ?, ?, ?)'
      ).bind(addressId, userId, emailAddress, now).run();

      autoCreatedAddress = emailAddress;
    } catch (addressError) {
      // If address creation fails, user can still create one manually later
      console.error('Failed to auto-create email address:', addressError);
    }

    return c.json(successResponse({
      user: {
        id: userId,
        token: token,
        is_admin: false,
        created_at: now,
      },
      email_address: autoCreatedAddress,
    }));
  } catch (error) {
    return c.json(errorResponse('Failed to register user', 500));
  }
});

// Get current user info
userRoutes.get('/me', requireAuth, async (c) => {
  const user = c.get('user');
  return c.json(formatUserForResponse(user));
});

// Delete current user account
userRoutes.delete('/me', requireAuth, async (c) => {
  const user = c.get('user');

  try {
    // Cascade delete: remove associated data first
    // 1. Delete emails linked to user's addresses
    await c.env.DB.prepare(
      `DELETE FROM emails WHERE address_id IN (
        SELECT id FROM email_addresses WHERE user_id = ?
      )`
    ).bind(user.id).run();
    // 2. Delete sent emails linked to user's addresses
    await c.env.DB.prepare(
      `DELETE FROM sent_emails WHERE address_id IN (
        SELECT id FROM email_addresses WHERE user_id = ?
      )`
    ).bind(user.id).run();
    // 3. Delete send permissions linked to user's addresses
    await c.env.DB.prepare(
      `DELETE FROM send_permissions WHERE address_id IN (
        SELECT id FROM email_addresses WHERE user_id = ?
      )`
    ).bind(user.id).run();
    // 4. Delete user's email addresses
    await c.env.DB.prepare('DELETE FROM email_addresses WHERE user_id = ?').bind(user.id).run();
    // 5. Delete the user
    await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
    return c.json(successResponse({ message: 'Account deleted' }));
  } catch (error) {
    return c.json(errorResponse('Failed to delete account', 500));
  }
});

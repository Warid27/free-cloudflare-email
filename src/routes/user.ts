import { Hono } from 'hono';
import { Env, Variables } from '../types';
import { generateToken, generateUUID, getCurrentTimestamp, formatUserForResponse, generateRandomEmailPrefix } from '../utils';
import { requireAuth } from '../middleware';
import { errorResponse, successResponse } from '../helpers';
import { getSettingWithDefault } from '../settings-cache';
import { createUser, createAddress, deleteUser } from '../db';

export const userRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Register a new user
userRoutes.post('/register', async (c) => {
  try {
    const userId = generateUUID();
    const token = generateToken();
    const now = getCurrentTimestamp();

    await createUser(c.env.DB, userId, token, now);

    // Auto-create an email address for the new user
    let autoCreatedAddress = null;
    try {
      const domain = await getSettingWithDefault(c.env.DB, 'domain', 'al-warid.web.id');
      const prefix = generateRandomEmailPrefix();
      const emailAddress = `${prefix}@${domain}`;
      const addressId = generateUUID();

      await createAddress(c.env.DB, addressId, userId, emailAddress, now);

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
    await deleteUser(c.env.DB, user.id);
    return c.json(successResponse({ message: 'Account deleted' }));
  } catch (error) {
    return c.json(errorResponse('Failed to delete account', 500));
  }
});

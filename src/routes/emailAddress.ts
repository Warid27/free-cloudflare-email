import { Hono } from 'hono';
import { Env, Variables } from '../types';
import {
  generateUUID,
  getCurrentTimestamp,
  generateRandomEmailPrefix,
  isValidEmailPrefix,
} from '../utils';
import { requireAuth, verifyAddressOwnership } from '../middleware';
import { errorResponse, successResponse } from '../helpers';

export const emailAddressRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Create a new email address
emailAddressRoutes.post('/', requireAuth, async (c) => {
  const user = c.get('user');
  let prefix: string | undefined;
  try {
    const body = await c.req.json();
    prefix = body?.prefix;
  } catch {
    // No body or invalid JSON — generate random prefix
  }

  try {
    // Get domain from settings
    const domainSetting = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?')
      .bind('domain')
      .first<{ value: string }>();

    const domain = domainSetting?.value || 'your-domain.com';

    // Generate or validate prefix
    let emailPrefix: string;
    if (prefix) {
      if (!isValidEmailPrefix(prefix)) {
        return c.json(errorResponse('Invalid email prefix format', 400));
      }
      emailPrefix = prefix.toLowerCase();
    } else {
      emailPrefix = generateRandomEmailPrefix();
    }

    const emailAddress = `${emailPrefix}@${domain}`;

    // Check if address already exists
    const existing = await c.env.DB.prepare(
      'SELECT id FROM email_addresses WHERE address = ?'
    ).bind(emailAddress).first();

    if (existing) {
      return c.json(errorResponse('Email address already exists', 409));
    }

    // Create the email address
    const addressId = generateUUID();
    const now = getCurrentTimestamp();

    await c.env.DB.prepare(
      'INSERT INTO email_addresses (id, user_id, address, created_at) VALUES (?, ?, ?, ?)'
    ).bind(addressId, user.id, emailAddress, now).run();

    return c.json(successResponse({
      address: {
        id: addressId,
        address: emailAddress,
        created_at: now,
      },
    }));
  } catch (error) {
    return c.json(errorResponse('Failed to create email address', 500));
  }
});

// Get all email addresses for current user
emailAddressRoutes.get('/', requireAuth, async (c) => {
  const user = c.get('user');

  try {
    const addresses = await c.env.DB.prepare(`
      SELECT
        ea.id,
        ea.address,
        ea.created_at,
        sp.status as send_permission_status
      FROM email_addresses ea
      LEFT JOIN send_permissions sp ON ea.id = sp.address_id
      WHERE ea.user_id = ?
      ORDER BY ea.created_at DESC
    `).bind(user.id).all();

    return c.json(successResponse({ addresses: addresses.results }));
  } catch (error) {
    return c.json(errorResponse('Failed to fetch email addresses', 500));
  }
});

// Delete an email address
emailAddressRoutes.delete('/:addressId', requireAuth, async (c) => {
  const user = c.get('user');
  const addressId = c.req.param('addressId');

  try {
    const address = await verifyAddressOwnership(c.env.DB, addressId, user.id);

    if (!address) {
      return c.json(errorResponse('Email address not found', 404));
    }

    await c.env.DB.prepare('DELETE FROM email_addresses WHERE id = ?').bind(addressId).run();

    return c.json(successResponse({ message: 'Email address deleted' }));
  } catch (error) {
    return c.json(errorResponse('Failed to delete email address', 500));
  }
});

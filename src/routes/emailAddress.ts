import { Hono } from 'hono';
import { Env, Variables } from '../types';
import {
  generateUUID,
  getCurrentTimestamp,
  generateRandomEmailPrefix,
  isValidEmailPrefix,
} from '../utils';
import { requireAuth } from '../middleware';
import { errorResponse, successResponse } from '../helpers';
import { getSettingWithDefault } from '../settings-cache';
import { createAddress, getAddressByString, verifyAddressOwnership, deleteAddress, listAddressesByUser } from '../db';

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
    const domain = await getSettingWithDefault(c.env.DB, 'domain', 'your-domain.com');

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

    const existing = await getAddressByString(c.env.DB, emailAddress);
    if (existing) {
      return c.json(errorResponse('Email address already exists', 409));
    }

    const addressId = generateUUID();
    const now = getCurrentTimestamp();
    await createAddress(c.env.DB, addressId, user.id, emailAddress, now);

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
    const addresses = await listAddressesByUser(c.env.DB, user.id);
    return c.json(successResponse({ addresses }));
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
    await deleteAddress(c.env.DB, addressId);
    return c.json(successResponse({ message: 'Email address deleted' }));
  } catch (error) {
    return c.json(errorResponse('Failed to delete email address', 500));
  }
});

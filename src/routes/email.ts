import { Hono } from 'hono';
import { Env, Variables } from '../types';
import { formatEmailForResponse, generateUUID, getCurrentTimestamp } from '../utils';
import { requireAuth } from '../middleware';
import { errorResponse, successResponse } from '../helpers';
import {
  verifyAddressOwnership,
  verifyAddressStringOwnership,
  verifyEmailOwnership,
  getEmailById,
  deleteEmail,
  getPermissionForAddress,
  createPermission,
} from '../db';

export const emailRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Get all emails for the current user (across all addresses)
emailRoutes.get('/', requireAuth, async (c) => {
  const user = c.get('user');
  const addressId = c.req.query('address_id');
  const countOnly = c.req.query('count_only') === 'true';
  const rawLimit = parseInt(c.req.query('limit') || '50');
  const rawOffset = parseInt(c.req.query('offset') || '0');
  const limit = isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 100);
  const offset = isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);

  try {
    let query;
    let params;

    if (countOnly) {
      if (addressId) {
        const address = await verifyAddressOwnership(c.env.DB, addressId, user.id);
        if (!address) return c.json({ count: 0 });

        query = 'SELECT COUNT(*) as count FROM emails WHERE address_id = ?';
        params = [addressId];
      } else {
        query = `SELECT COUNT(*) as count
                 FROM emails e
                 INNER JOIN email_addresses ea ON e.address_id = ea.id
                 WHERE ea.user_id = ?`;
        params = [user.id];
      }

      const result = await c.env.DB.prepare(query).bind(...params).first<{ count: number }>();
      return c.json({ count: result?.count || 0 });
    }

    if (addressId) {
      const address = await verifyAddressOwnership(c.env.DB, addressId, user.id);
      if (!address) {
        return c.json(errorResponse('Email address not found or unauthorized', 404));
      }

      query = `SELECT e.id, e.from_address, e.to_address, e.subject, e.received_at, e.expires_at, e.is_read
               FROM emails e
               WHERE e.address_id = ? ORDER BY e.received_at DESC LIMIT ? OFFSET ?`;
      params = [addressId, limit, offset];
    } else {
      query = `SELECT e.id, e.from_address, e.to_address, e.subject, e.received_at, e.expires_at, e.is_read
               FROM emails e
               INNER JOIN email_addresses ea ON e.address_id = ea.id
               WHERE ea.user_id = ? ORDER BY e.received_at DESC LIMIT ? OFFSET ?`;
      params = [user.id, limit, offset];
    }

    const emails = await c.env.DB.prepare(query).bind(...params).all();

    return c.json(successResponse({
      emails: emails.results,
      pagination: {
        limit,
        offset,
        has_more: emails.results.length === limit,
      },
    }));
  } catch (error) {
    return c.json(errorResponse('Failed to fetch emails', 500));
  }
});

// Get all emails for a specific email address (Legacy/Specific route)
emailRoutes.get('/address/:addressId', requireAuth, async (c) => {
  const user = c.get('user');
  const addressId = c.req.param('addressId');
  const rawLimit = parseInt(c.req.query('limit') || '50');
  const rawOffset = parseInt(c.req.query('offset') || '0');
  const limit = isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 100);
  const offset = isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);

  try {
    const address = await verifyAddressOwnership(c.env.DB, addressId, user.id);
    if (!address) {
      return c.json(errorResponse('Email address not found or unauthorized', 404));
    }

    const emails = await c.env.DB.prepare(
      `SELECT id, from_address, to_address, subject, received_at, expires_at, is_read
       FROM emails WHERE address_id = ? ORDER BY received_at DESC LIMIT ? OFFSET ?`
    ).bind(addressId, limit, offset).all();

    const permission = await c.env.DB.prepare(
      'SELECT status FROM send_permissions WHERE address_id = ?'
    ).bind(addressId).first<{ status: string }>();

    return c.json(successResponse({
      emails: emails.results,
      send_permission_status: permission?.status ?? null,
      pagination: {
        limit,
        offset,
        has_more: emails.results.length === limit,
      },
    }));
  } catch (error) {
    return c.json(errorResponse('Failed to fetch emails', 500));
  }
});

// Get a specific email by ID
emailRoutes.get('/:emailId', requireAuth, async (c) => {
  const user = c.get('user');
  const emailId = c.req.param('emailId');

  try {
    const email = await getEmailById(
      c.env.DB,
      emailId,
      user.is_admin ? undefined : user.id
    );

    if (!email) {
      return c.json(errorResponse('Email not found', 404));
    }

    return c.json(successResponse({ email: formatEmailForResponse(email) }));
  } catch (error) {
    return c.json(errorResponse('Failed to fetch email', 500));
  }
});

// Delete an email
emailRoutes.delete('/:emailId', requireAuth, async (c) => {
  const user = c.get('user');
  const emailId = c.req.param('emailId');

  try {
    const ownership = await verifyEmailOwnership(c.env.DB, emailId, user.id);
    if (!ownership) {
      return c.json(errorResponse('Email not found', 404));
    }

    await deleteEmail(c.env.DB, emailId);

    return c.json(successResponse({ message: 'Email deleted' }));
  } catch (error) {
    return c.json(errorResponse('Failed to delete email', 500));
  }
});

// Request permission to send emails from an address
emailRoutes.post('/address/:addressId/request-send', requireAuth, async (c) => {
  const user = c.get('user');
  const addressId = c.req.param('addressId');

  try {
    const address = await verifyAddressOwnership(c.env.DB, addressId, user.id);
    if (!address) {
      return c.json(errorResponse('Email address not found', 404));
    }

    const existing = await getPermissionForAddress(c.env.DB, addressId);

    if (existing) {
      return c.json(successResponse({
        message: 'Request already exists',
        status: existing.status
      }));
    }

    const permissionId = generateUUID();
    const now = getCurrentTimestamp();
    await createPermission(c.env.DB, permissionId, addressId, now);

    return c.json(successResponse({
      permission: {
        id: permissionId,
        status: 'pending',
        requested_at: now,
      },
    }));
  } catch (error) {
    return c.json(errorResponse('Failed to request send permission', 500));
  }
});

// Send an email (requires approved permission)
emailRoutes.post('/send', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { from, to, subject, text, html } = body;

  try {
    const address = await verifyAddressStringOwnership(c.env.DB, from, user.id);
    if (!address) {
      return c.json(errorResponse('From address not found or unauthorized', 404));
    }

    const permission = await getPermissionForAddress(c.env.DB, address.id, 'approved');

    if (!permission) {
      return c.json(errorResponse('Send permission not approved for this address', 403));
    }

    try {
      await c.env.SEND_EMAIL.send({
        from: from,
        to: to,
        subject: subject,
        text: text,
        html: html,
      });

      // Save sent email to database for admin visibility
      const sentEmailId = generateUUID();
      const now = getCurrentTimestamp();
      try {
        await c.env.DB.prepare(
          'INSERT INTO sent_emails (id, address_id, from_address, to_address, subject, body_text, body_html, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(sentEmailId, address.id, from, to, subject, text || null, html || null, now).run();
      } catch (saveError) {
        // Log but don't fail the send if saving fails
        console.error('Failed to save sent email record:', saveError);
      }

      return c.json(successResponse({ message: 'Email sent' }));
    } catch (sendError) {
      return c.json(errorResponse('Failed to send email', 500));
    }
  } catch (error) {
    return c.json(errorResponse('Failed to process send request', 500));
  }
});

// Mark an email as read
emailRoutes.post('/:emailId/mark-read', requireAuth, async (c) => {
  const user = c.get('user');
  const emailId = c.req.param('emailId');

  try {
    const now = getCurrentTimestamp();
    const result = await c.env.DB.prepare(
      `UPDATE emails SET is_read = 1, read_at = ?
       WHERE id = ? AND address_id IN (
         SELECT id FROM email_addresses WHERE user_id = ?
       )`
    ).bind(now, emailId, user.id).run();

    if (result.meta.changes === 0) {
      return c.json(errorResponse('Email not found', 404));
    }

    return c.json(successResponse({ message: 'Email marked as read' }));
  } catch (error) {
    return c.json(errorResponse('Failed to mark email as read', 500));
  }
});

// Mark an email as unread
emailRoutes.post('/:emailId/mark-unread', requireAuth, async (c) => {
  const user = c.get('user');
  const emailId = c.req.param('emailId');

  try {
    const result = await c.env.DB.prepare(
    `UPDATE emails SET is_read = 0, read_at = NULL
     WHERE id = ? AND address_id IN (
       SELECT id FROM email_addresses WHERE user_id = ?
     )`
  ).bind(emailId, user.id).run();

  if (result.meta.changes === 0) {
    return c.json(errorResponse('Email not found', 404));
  }

  return c.json(successResponse({ message: 'Email marked as unread' }));
  } catch (error) {
    return c.json(errorResponse('Failed to mark email as unread', 500));
  }
});

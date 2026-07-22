import { Context } from 'hono';
import { Env, User, Variables } from './types';

export async function authenticateUser(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<User | null> {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  
  try {
    const user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE token = ? AND is_banned = 0'
    ).bind(token).first<User>();

    return user;
  } catch (error) {
    console.error('Authentication error:', error);
    return null;
  }
}

export async function requireAuth(c: Context<{ Bindings: Env; Variables: Variables }>, next: Function) {
  const user = await authenticateUser(c);
  
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('user', user);
  await next();
}

export async function requireAdmin(c: Context<{ Bindings: Env; Variables: Variables }>, next: Function) {
  const user = await authenticateUser(c);
  
  if (!user || !user.is_admin) {
    return c.json({ error: 'Forbidden - Admin access required' }, 403);
  }

  c.set('user', user);
  await next();
}

// --- Ownership Verification Helpers ---

export interface VerifiedAddress {
  id: string;
}

/**
 * Verify that an email address belongs to the authenticated user.
 * Returns the address record if verified, null otherwise.
 */
export async function verifyAddressOwnership(
  db: D1Database,
  addressId: string,
  userId: string
): Promise<VerifiedAddress | null> {
  const address = await db
    .prepare('SELECT id FROM email_addresses WHERE id = ? AND user_id = ?')
    .bind(addressId, userId)
    .first<VerifiedAddress>();
  return address ?? null;
}

/**
 * Verify that an email address string belongs to the authenticated user.
 * Useful for the /send endpoint which receives the address as a string.
 * Returns the full address record if verified, null otherwise.
 */
export async function verifyAddressStringOwnership(
  db: D1Database,
  addressString: string,
  userId: string
): Promise<VerifiedAddress | null> {
  const address = await db
    .prepare('SELECT id FROM email_addresses WHERE address = ? AND user_id = ?')
    .bind(addressString, userId)
    .first<VerifiedAddress>();
  return address ?? null;
}

/**
 * Verify that an email belongs to the authenticated user (via JOIN on email_addresses).
 * Returns the email record if verified, null otherwise.
 */
export async function verifyEmailOwnership(
  db: D1Database,
  emailId: string,
  userId: string
): Promise<{ id: string } | null> {
  const email = await db
    .prepare(
      `SELECT e.id FROM emails e
       INNER JOIN email_addresses ea ON e.address_id = ea.id
       WHERE e.id = ? AND ea.user_id = ?`
    )
    .bind(emailId, userId)
    .first<{ id: string }>();
  return email ?? null;
}

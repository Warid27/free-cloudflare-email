import { D1Database } from '@cloudflare/workers-types';
import { User } from './types';

// ─── Users ───────────────────────────────────────────────────────────

export async function getUserByToken(
  db: D1Database,
  token: string
): Promise<User | null> {
  const user = await db
    .prepare('SELECT * FROM users WHERE token = ? AND is_banned = 0')
    .bind(token)
    .first<User>();
  return user ?? null;
}

export async function getUserById(
  db: D1Database,
  userId: string
): Promise<User | null> {
  const user = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(userId)
    .first<User>();
  return user ?? null;
}

export async function createUser(
  db: D1Database,
  id: string,
  token: string,
  now: number
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO users (id, token, is_admin, is_banned, created_at, updated_at) VALUES (?, ?, 0, 0, ?, ?)'
    )
    .bind(id, token, now, now)
    .run();
}

export async function deleteUser(db: D1Database, userId: string): Promise<void> {
  // Cascade: emails → sent_emails → permissions → addresses → user
  const addressIds = await db
    .prepare('SELECT id FROM email_addresses WHERE user_id = ?')
    .bind(userId)
    .all<{ id: string }>();

  if (addressIds.results.length > 0) {
    const ids = addressIds.results.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');

    await db
      .prepare(`DELETE FROM emails WHERE address_id IN (${placeholders})`)
      .bind(...ids)
      .run();

    await db
      .prepare(`DELETE FROM sent_emails WHERE address_id IN (${placeholders})`)
      .bind(...ids)
      .run();

    await db
      .prepare(`DELETE FROM send_permissions WHERE address_id IN (${placeholders})`)
      .bind(...ids)
      .run();
  }

  await db.prepare('DELETE FROM email_addresses WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
}

// ─── Email Addresses ─────────────────────────────────────────────────

export async function getAddressByString(
  db: D1Database,
  address: string
): Promise<{ id: string } | null> {
  const row = await db
    .prepare('SELECT id FROM email_addresses WHERE address = ?')
    .bind(address)
    .first<{ id: string }>();
  return row ?? null;
}

export async function getAddressById(
  db: D1Database,
  addressId: string
): Promise<{ id: string; address: string; user_id: string } | null> {
  const row = await db
    .prepare('SELECT id, address, user_id FROM email_addresses WHERE id = ?')
    .bind(addressId)
    .first<{ id: string; address: string; user_id: string }>();
  return row ?? null;
}

export async function verifyAddressOwnership(
  db: D1Database,
  addressId: string,
  userId: string
): Promise<{ id: string } | null> {
  const row = await db
    .prepare('SELECT id FROM email_addresses WHERE id = ? AND user_id = ?')
    .bind(addressId, userId)
    .first<{ id: string }>();
  return row ?? null;
}

export async function verifyAddressStringOwnership(
  db: D1Database,
  addressString: string,
  userId: string
): Promise<{ id: string } | null> {
  const row = await db
    .prepare('SELECT id FROM email_addresses WHERE address = ? AND user_id = ?')
    .bind(addressString, userId)
    .first<{ id: string }>();
  return row ?? null;
}

export async function createAddress(
  db: D1Database,
  id: string,
  userId: string,
  address: string,
  now: number
): Promise<void> {
  await db
    .prepare('INSERT INTO email_addresses (id, user_id, address, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, userId, address, now)
    .run();
}

export async function deleteAddress(db: D1Database, addressId: string): Promise<void> {
  await db.prepare('DELETE FROM email_addresses WHERE id = ?').bind(addressId).run();
}

export async function listAddressesByUser(
  db: D1Database,
  userId: string
): Promise<unknown[]> {
  const result = await db
    .prepare(
      `SELECT ea.id, ea.address, ea.created_at, sp.status as send_permission_status
       FROM email_addresses ea
       LEFT JOIN send_permissions sp ON ea.id = sp.address_id
       WHERE ea.user_id = ?
       ORDER BY ea.created_at DESC`
    )
    .bind(userId)
    .all();
  return result.results;
}

// ─── Emails ──────────────────────────────────────────────────────────

export async function verifyEmailOwnership(
  db: D1Database,
  emailId: string,
  userId: string
): Promise<{ id: string } | null> {
  const row = await db
    .prepare(
      `SELECT e.id FROM emails e
       INNER JOIN email_addresses ea ON e.address_id = ea.id
       WHERE e.id = ? AND ea.user_id = ?`
    )
    .bind(emailId, userId)
    .first<{ id: string }>();
  return row ?? null;
}

export async function getEmailById(
  db: D1Database,
  emailId: string,
  userId?: string
): Promise<unknown | null> {
  if (userId) {
    const row = await db
      .prepare(
        `SELECT e.* FROM emails e
         INNER JOIN email_addresses ea ON e.address_id = ea.id
         WHERE e.id = ? AND ea.user_id = ?`
      )
      .bind(emailId, userId)
      .first();
    return row ?? null;
  }
  const row = await db.prepare('SELECT * FROM emails WHERE id = ?').bind(emailId).first();
  return row ?? null;
}

export async function deleteEmail(db: D1Database, emailId: string): Promise<void> {
  await db.prepare('DELETE FROM emails WHERE id = ?').bind(emailId).run();
}

// ─── Send Permissions ────────────────────────────────────────────────

export async function getPermissionForAddress(
  db: D1Database,
  addressId: string,
  status?: string
): Promise<{ id: string; status: string } | null> {
  let query = 'SELECT id, status FROM send_permissions WHERE address_id = ?';
  const params: string[] = [addressId];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  const row = await db.prepare(query).bind(...params).first<{ id: string; status: string }>();
  return row ?? null;
}

export async function createPermission(
  db: D1Database,
  id: string,
  addressId: string,
  now: number
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO send_permissions (id, address_id, status, requested_at) VALUES (?, ?, ?, ?)'
    )
    .bind(id, addressId, 'pending', now)
    .run();
}

// ─── Settings ────────────────────────────────────────────────────────

export async function updateSetting(
  db: D1Database,
  key: string,
  value: string,
  now: number
): Promise<void> {
  await db
    .prepare('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?')
    .bind(value, now, key)
    .run();
}

import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const HASH = process.env.ADMIN_PASSWORD_HASH || '';
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h; browser scheduler can run while dashboard stays open.

function secret() {
  const value = process.env.ENCRYPTION_KEY_BASE64_32_BYTES || '';
  if (!value) throw new Error('ENCRYPTION_KEY_BASE64_32_BYTES is not configured');
  return value;
}

export async function verifyPassword(password: string) {
  if (typeof password !== 'string' || !password || !HASH) return false;
  return bcrypt.compare(password, HASH);
}

export function signSession() {
  const exp = Date.now() + SESSION_TTL_MS;
  const sig = crypto.createHmac('sha256', secret()).update(`poppygram-admin:${exp}`).digest('hex');
  return `${exp}.${sig}`;
}

export function sessionExpiryMs(req: NextApiRequest) {
  const c = req.cookies?.admin_session;
  if (typeof c !== 'string') return null;
  const dot = c.indexOf('.');
  if (dot < 0) return null;
  const exp = Number(c.slice(0, dot));
  return Number.isFinite(exp) ? exp : null;
}

export function isAdmin(req: NextApiRequest) {
  const c = req.cookies?.admin_session;
  if (typeof c !== 'string') return false;
  try {
    const dot = c.indexOf('.');
    if (dot < 0) return false;
    const exp = Number(c.slice(0, dot));
    if (!Number.isFinite(exp) || exp <= Date.now()) return false;
    const expected = crypto.createHmac('sha256', secret()).update(`poppygram-admin:${exp}`).digest('hex');
    const given = c.slice(dot + 1);
    const a = Buffer.from(given, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function requireAdmin(req: NextApiRequest, res: NextApiResponse) {
  if (!isAdmin(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

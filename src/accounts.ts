import type { Env } from './ai';

/**
 * Tài khoản trang quản lý: mật khẩu băm PBKDF2, token ký HMAC, liên kết Telegram bằng mã xác minh.
 * Dữ liệu của tài khoản nằm dưới "chat key": chat_id Telegram đã liên kết, chưa liên kết thì -id.
 */

export type User = {
  id: number;
  username: string;
  password_hash: string;
  chat_id: number | null;
  token_version: number;
  created_at: number;
  last_login_at: number | null;
};

const enc = new TextEncoder();
const TOKEN_DAYS = 7;
// Gói Free của Workers giới hạn CPU mỗi request nên giữ số vòng vừa phải; lưu kèm trong hash để tăng sau được.
const PBKDF2_ROUNDS = 10_000;

export const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** So sánh không lộ thời gian. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, rounds: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64url(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256));
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ROUNDS}$${b64url(salt)}$${await pbkdf2(password, salt, PBKDF2_ROUNDS)}`;
}

export async function checkPassword(password: string, stored: string) {
  const [scheme, rounds, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !rounds || !salt || !hash) return false;
  return safeEqual(await pbkdf2(password, fromB64url(salt), Number(rounds)), hash);
}

const sha256 = async (text: string) => b64url(await crypto.subtle.digest('SHA-256', enc.encode(text)));

// ---------- Token ----------

const secret = (env: Env) => {
  const s = env.AUTH_SECRET || env.ADMIN_PASSWORD;
  if (!s) throw new Error('Thiếu AUTH_SECRET');
  return s;
};

async function hmac(key: string, data: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

export async function issueToken(env: Env, user: User) {
  const payload = b64url(enc.encode(JSON.stringify({ uid: user.id, tv: user.token_version, exp: Date.now() + TOKEN_DAYS * 86_400_000 })));
  return `${payload}.${await hmac(secret(env), payload)}`;
}

/** Token hợp lệ -> người dùng; hết hạn, sai chữ ký hoặc đã đổi mật khẩu -> null. */
export async function userFromToken(env: Env, header: string | null): Promise<User | null> {
  const token = header?.replace(/^Bearer\s+/i, '') ?? '';
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, await hmac(secret(env), payload))) return null;
  try {
    const { uid, tv, exp } = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { uid?: number; tv?: number; exp: number };
    if (!uid || Date.now() >= exp) return null;
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first<User>();
    return user && user.token_version === (tv ?? 0) ? user : null;
  } catch {
    return null;
  }
}

// ---------- Tài khoản ----------

/** Khóa dữ liệu của tài khoản trong mọi bảng (cột chat_id). */
export const chatKey = (user: Pick<User, 'id' | 'chat_id'>) => user.chat_id ?? -user.id;

export const findUser = (env: Env, username: string) =>
  env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username.trim()).first<User>();

export async function createUser(env: Env, username: string, password: string) {
  return env.DB.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?) RETURNING *')
    .bind(username.trim(), await hashPassword(password), Date.now())
    .first<User>();
}

export function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9._-]{3,32}$/.test(username.trim())) {
    return 'Tên đăng nhập 3–32 ký tự, chỉ gồm chữ không dấu, số và . _ -';
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return 'Mật khẩu ít nhất 8 ký tự';
  return null;
}

/** Chat id được dùng bot: đã liên kết tài khoản, hoặc nằm trong ALLOWED_CHAT_IDS (chủ bot, trước khi có tài khoản). */
export async function linkedChats(env: Env) {
  const rows = await env.DB.prepare('SELECT chat_id FROM users WHERE chat_id IS NOT NULL').all<{ chat_id: number }>();
  const fromEnv = (env.ALLOWED_CHAT_IDS ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set([...rows.results.map((r) => r.chat_id), ...fromEnv])];
}

export async function isAllowedChat(env: Env, chatId: number) {
  if ((env.ALLOWED_CHAT_IDS ?? '').split(',').some((s) => s.trim() === String(chatId))) return true;
  return !!(await env.DB.prepare('SELECT 1 FROM users WHERE chat_id = ?').bind(chatId).first());
}

// ---------- Liên kết Telegram ----------

/** Bảng có dữ liệu theo chat_id: chuyển cả khi liên kết / hủy liên kết. */
const DATA_TABLES = [
  'expenses',
  'trips',
  'incomes',
  'goals',
  'recurring',
  'credit_charges',
  'balances',
  'bot_messages',
  'debts',
  'debt_payments',
];
/** Bảng có khóa chính gồm chat_id: chỉ chuyển khi đích chưa có dòng trùng. */
const KEYED_TABLES: [string, string][] = [
  ['settings', 'chat_id'],
  ['jars', 'jar'],
  ['category_jars', 'category'],
  ['prefs', 'key'],
  ['cycles', 'start_on'],
];

/** Chuyển dữ liệu từ khóa này sang khóa khác (VD từ -id sang chat Telegram khi liên kết). */
export async function moveData(env: Env, from: number, to: number) {
  if (from === to) return;
  await env.DB.batch([
    ...DATA_TABLES.map((t) => env.DB.prepare(`UPDATE ${t} SET chat_id = ? WHERE chat_id = ?`).bind(to, from)),
    ...KEYED_TABLES.flatMap(([t, k]) => [
      env.DB.prepare(
        k === 'chat_id'
          ? `UPDATE ${t} SET chat_id = ? WHERE chat_id = ? AND NOT EXISTS (SELECT 1 FROM ${t} WHERE chat_id = ?)`
          : `UPDATE ${t} SET chat_id = ? WHERE chat_id = ? AND ${k} NOT IN (SELECT ${k} FROM ${t} WHERE chat_id = ?)`,
      ).bind(to, from, to),
      env.DB.prepare(`DELETE FROM ${t} WHERE chat_id = ?`).bind(from),
    ]),
  ]);
}

const CODE_MINUTES = 10;

/** Tạo mã 6 số cho việc liên kết chat; trả về mã để bot gửi. Lỗi (chuỗi) nếu chat đã thuộc tài khoản khác hoặc gửi quá nhanh. */
export async function startLink(env: Env, user: User, chatId: number): Promise<{ code: string } | { error: string }> {
  const owner = await env.DB.prepare('SELECT id FROM users WHERE chat_id = ?').bind(chatId).first<{ id: number }>();
  if (owner && owner.id !== user.id) return { error: 'ID Telegram này đã liên kết với tài khoản khác.' };
  if (owner) return { error: 'Tài khoản đã liên kết với ID này rồi.' };
  const last = await env.DB.prepare('SELECT sent_at FROM link_codes WHERE user_id = ?').bind(user.id).first<{ sent_at: number }>();
  if (last && Date.now() - last.sent_at < 60_000) return { error: 'Vừa gửi mã rồi, đợi 1 phút rồi thử lại.' };
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  await env.DB.prepare(
    `INSERT INTO link_codes (user_id, chat_id, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET chat_id = excluded.chat_id, code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`,
  )
    .bind(user.id, chatId, await sha256(`${user.id}:${code}`), Date.now() + CODE_MINUTES * 60_000, Date.now())
    .run();
  return { code };
}

/** Kiểm tra mã; đúng thì liên kết và chuyển dữ liệu web (-id) sang chat Telegram. */
export async function confirmLink(env: Env, user: User, code: string): Promise<{ chatId: number } | { error: string }> {
  const row = await env.DB.prepare('SELECT * FROM link_codes WHERE user_id = ?')
    .bind(user.id)
    .first<{ chat_id: number; code_hash: string; expires_at: number; attempts: number }>();
  if (!row || Date.now() > row.expires_at) return { error: 'Mã đã hết hạn, bấm gửi lại mã.' };
  if (row.attempts >= 5) return { error: 'Nhập sai quá nhiều lần, bấm gửi lại mã.' };
  if (!safeEqual(await sha256(`${user.id}:${code.trim()}`), row.code_hash)) {
    await env.DB.prepare('UPDATE link_codes SET attempts = attempts + 1 WHERE user_id = ?').bind(user.id).run();
    return { error: 'Mã không đúng.' };
  }
  const taken = await env.DB.prepare('SELECT id FROM users WHERE chat_id = ? AND id <> ?').bind(row.chat_id, user.id).first();
  if (taken) return { error: 'ID Telegram này đã liên kết với tài khoản khác.' };
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET chat_id = ? WHERE id = ?').bind(row.chat_id, user.id),
    env.DB.prepare('DELETE FROM link_codes WHERE user_id = ?').bind(user.id),
  ]);
  await moveData(env, chatKey(user), row.chat_id);
  return { chatId: row.chat_id };
}

/** Hủy liên kết: dữ liệu đi theo tài khoản (về -id), bot không nhận chat đó nữa. */
export async function unlink(env: Env, user: User) {
  if (!user.chat_id) return;
  await env.DB.prepare('UPDATE users SET chat_id = NULL WHERE id = ?').bind(user.id).run();
  await moveData(env, user.chat_id, -user.id);
}

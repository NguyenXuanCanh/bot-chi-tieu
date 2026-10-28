import type { Env } from './ai';
import { addMonths, daysInMonth, monthOf } from './core';

/**
 * Khoản chi cố định hàng tháng (tiền nhà, Netflix, trả góp...).
 * Cron chạy mỗi ngày (wrangler.toml [triggers]) gọi runRecurring: khoản nào tới ngày mà tháng này chưa trừ thì ghi thành chi tiêu.
 */

export type Recurring = {
  id: number;
  chat_id: number;
  item: string;
  amount: number;
  category: string;
  day: number;
  active: number;
  start_month: string;
  last_month: string | null;
  created_at: number;
};

/** Ngày trừ thật trong tháng (ngày 31 ở tháng 2 -> ngày cuối tháng). */
export const dueDay = (r: Pick<Recurring, 'day'>, month: string) => Math.min(r.day, daysInMonth(month));
const dueDate = (r: Pick<Recurring, 'day'>, month: string) => `${month}-${String(dueDay(r, month)).padStart(2, '0')}`;
const isDue = (r: Recurring, today: string) =>
  r.active === 1 && r.start_month <= monthOf(today) && r.last_month !== monthOf(today) && Number(today.slice(8, 10)) >= dueDay(r, monthOf(today));

export const listRecurring = (env: Env, chat: number) =>
  env.DB.prepare('SELECT * FROM recurring WHERE chat_id = ? ORDER BY active DESC, day, id').bind(chat).all<Recurring>().then((r) => r.results);

/**
 * Thêm khoản cố định. Nếu tháng này đã qua ngày trừ: chargeNow = true thì trừ luôn tháng này,
 * không thì bắt đầu từ tháng sau (tránh trùng với khoản đã ghi tay).
 */
export async function addRecurring(
  env: Env,
  chat: number,
  r: { item: string; amount: number; category: string; day: number },
  today: string,
  chargeNow: boolean,
) {
  const month = monthOf(today);
  const passed = Number(today.slice(8, 10)) >= dueDay(r, month);
  const row = await env.DB.prepare(
    'INSERT INTO recurring (chat_id, item, amount, category, day, start_month, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
  )
    .bind(chat, r.item, r.amount, r.category, r.day, passed && !chargeNow ? addMonths(month, 1) : month, Date.now())
    .first<Recurring>();
  // Đã tới ngày và muốn trừ luôn: ghi ngay thay vì chờ cron đêm nay.
  const charged = passed && chargeNow ? await chargeOne(env, row!, today) : false;
  return { row: row!, passed, charged };
}

/** Ghi khoản cố định thành chi tiêu của tháng này (nếu chưa trừ; trừ tay được cả khi chưa tới tháng bắt đầu). Trả về true nếu vừa ghi. */
export async function chargeOne(env: Env, r: Recurring, today: string) {
  const month = monthOf(today);
  // Cập nhật last_month có điều kiện để cron và lệnh tay chạy cùng lúc cũng không ghi 2 lần.
  const claimed = await env.DB.prepare('UPDATE recurring SET last_month = ? WHERE id = ? AND (last_month IS NULL OR last_month <> ?) RETURNING id')
    .bind(month, r.id, month)
    .first();
  if (!claimed) return false;
  const day = dueDate(r, month) <= today ? dueDate(r, month) : today;
  await env.DB.prepare('INSERT INTO expenses (chat_id, amount, item, category, spent_on, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(r.chat_id, r.amount, r.item, r.category, day, Date.now())
    .run();
  return true;
}

/** Trừ mọi khoản tới hạn của mọi chat; trả về các khoản vừa trừ theo chat để nhắn báo. */
export async function runRecurring(env: Env, today: string) {
  const rows = await env.DB.prepare('SELECT * FROM recurring WHERE active = 1 AND start_month <= ? AND (last_month IS NULL OR last_month <> ?)')
    .bind(monthOf(today), monthOf(today))
    .all<Recurring>();
  const charged = new Map<number, Recurring[]>();
  for (const r of rows.results) {
    if (!isDue(r, today)) continue;
    if (await chargeOne(env, r, today)) charged.set(r.chat_id, [...(charged.get(r.chat_id) ?? []), r]);
  }
  return charged;
}

/** Tổng chi cố định mỗi tháng (khoản đang bật). */
export async function recurringTotal(env: Env, chat: number) {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM recurring WHERE chat_id = ? AND active = 1').bind(chat).first<{ s: number }>();
  return row?.s ?? 0;
}

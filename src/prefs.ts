import type { Env } from './ai';

/** Tùy chọn nhỏ theo chat (bảng prefs): remind = '0' tắt nhắc 21h, payday = ngày nhận lương. */

export async function getPref(env: Env, chat: number, key: string) {
  const row = await env.DB.prepare('SELECT value FROM prefs WHERE chat_id = ? AND key = ?').bind(chat, key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setPref(env: Env, chat: number, key: string, value: string) {
  await env.DB.prepare('INSERT INTO prefs (chat_id, key, value) VALUES (?, ?, ?) ON CONFLICT(chat_id, key) DO UPDATE SET value = excluded.value')
    .bind(chat, key, value)
    .run();
}

/** Ngày nhận lương hằng tháng (1–28 để tháng nào cũng có), mặc định 27: lương tháng 10 về ngày 27/10. */
export const DEFAULT_PAYDAY = 27;
export async function getPayday(env: Env, chat: number) {
  const n = Number(await getPref(env, chat, 'payday'));
  return Number.isInteger(n) && n >= 1 && n <= 28 ? n : DEFAULT_PAYDAY;
}

/**
 * Ngày khoản thu thật sự về tài khoản (SQL): ngày nhận lương của tháng đó, hoặc ngày nhập nếu nhập muộn hơn
 * (nhập sau ngày lương / thưởng ghi muộn coi như đã về lúc nhập). Dùng với bảng incomes, tham số = ngày lương.
 */
export const RECEIVED_ON_SQL = "MAX(date(created_at / 1000, 'unixepoch', '+7 hours'), month || '-' || printf('%02d', ?))";

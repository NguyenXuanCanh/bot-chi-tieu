import type { Env } from './ai';
import { addMonths, formatDay, monthOf } from './core';

/**
 * Nợ thẻ tín dụng: khoản quẹt thẻ không tính vào chi tiêu tháng quẹt.
 * Ngày 1 tháng sau (cron hằng ngày gọi settleCredit) mỗi khoản thành một chi tiêu ngày 1 của tháng sau, giữ danh mục (nên vào đúng hũ).
 */

export type CreditCharge = {
  id: number;
  chat_id: number;
  amount: number;
  item: string;
  category: string;
  spent_on: string;
  settled: number;
  created_at: number;
};

/** Tháng mà khoản quẹt thẻ được tính vào chi tiêu. */
export const billedMonth = (spentOn: string) => addMonths(monthOf(spentOn), 1);

export async function addCharges(
  env: Env,
  chat: number,
  items: { item: string; amount: number; category: string }[],
  day: string,
  messageId: number | null,
) {
  const now = Date.now();
  await env.DB.batch(
    items.map((i) =>
      env.DB.prepare('INSERT INTO credit_charges (chat_id, amount, item, category, spent_on, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
        chat,
        i.amount,
        i.item,
        i.category,
        day,
        messageId,
        now,
      ),
    ),
  );
}

/** Các khoản chưa chuyển thành chi tiêu, mới nhất trước. */
export const pendingCharges = (env: Env, chat: number) =>
  env.DB.prepare('SELECT * FROM credit_charges WHERE chat_id = ? AND settled = 0 ORDER BY spent_on DESC, id DESC')
    .bind(chat)
    .all<CreditCharge>()
    .then((r) => r.results);

/** Chuyển các khoản quẹt thẻ của những tháng trước thành chi tiêu (ngày 1 của tháng kế tiếp tháng quẹt). */
export async function settleCredit(env: Env, today: string, chat?: number) {
  const rows = await env.DB.prepare(
    `SELECT * FROM credit_charges WHERE settled = 0 AND spent_on < ?${chat ? ' AND chat_id = ?' : ''} ORDER BY spent_on, id`,
  )
    .bind(...(chat ? [`${monthOf(today)}-01`, chat] : [`${monthOf(today)}-01`]))
    .all<CreditCharge>();
  const settled = new Map<number, CreditCharge[]>();
  for (const c of rows.results) {
    // Đánh dấu có điều kiện trước để chạy trùng cũng không ghi 2 lần.
    const claimed = await env.DB.prepare('UPDATE credit_charges SET settled = 1 WHERE id = ? AND settled = 0 RETURNING id').bind(c.id).first();
    if (!claimed) continue;
    await env.DB.prepare('INSERT INTO expenses (chat_id, amount, item, category, spent_on, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(c.chat_id, c.amount, `${c.item} (thẻ ${formatDay(c.spent_on)})`.slice(0, 80), c.category, `${billedMonth(c.spent_on)}-01`, Date.now())
      .run();
    settled.set(c.chat_id, [...(settled.get(c.chat_id) ?? []), c]);
  }
  return settled;
}

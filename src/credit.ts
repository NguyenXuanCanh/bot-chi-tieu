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

export type EarlyPayment = { paid: number; items: { item: string; amount: number; spent_on: string; partial: boolean }[]; remaining: number };

/**
 * Thanh toán sớm nợ thẻ: các khoản được trả thành chi tiêu NGÀY TRẢ (trừ vào số dư ngay, tính vào hũ tháng trả).
 * amount = null: trả hết. Trả một phần thì trả khoản quẹt cũ nhất trước; khoản trả dở giữ phần còn lại trong nợ.
 */
export async function payEarly(env: Env, chat: number, amount: number | null, today: string): Promise<EarlyPayment> {
  const rows = (await pendingCharges(env, chat)).reverse(); // cũ nhất trước
  let budget = amount ?? rows.reduce((s, c) => s + c.amount, 0);
  const items: EarlyPayment['items'] = [];
  for (const c of rows) {
    if (budget <= 0) break;
    const part = Math.min(c.amount, budget);
    const partial = part < c.amount;
    // Khóa có điều kiện: chạy trùng (bấm 2 lần, cron ngày 1) không trả 2 lần.
    const claimed = partial
      ? await env.DB.prepare('UPDATE credit_charges SET amount = amount - ? WHERE id = ? AND settled = 0 AND amount = ? RETURNING id')
          .bind(part, c.id, c.amount)
          .first()
      : await env.DB.prepare('UPDATE credit_charges SET settled = 1 WHERE id = ? AND settled = 0 RETURNING id').bind(c.id).first();
    if (!claimed) continue;
    await env.DB.prepare('INSERT INTO expenses (chat_id, amount, item, category, spent_on, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(chat, part, `${c.item} (thẻ ${formatDay(c.spent_on)}${partial ? ', trả một phần' : ''})`.slice(0, 80), c.category, today, Date.now())
      .run();
    items.push({ item: c.item, amount: part, spent_on: c.spent_on, partial });
    budget -= part;
  }
  const remaining = (await pendingCharges(env, chat)).reduce((s, c) => s + c.amount, 0);
  return { paid: items.reduce((s, i) => s + i.amount, 0), items, remaining };
}

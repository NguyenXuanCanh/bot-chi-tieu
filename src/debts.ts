import type { Env } from './ai';
import { plain, type DebtDirection } from './core';

/**
 * Sổ nợ: cho mượn / đi vay, trả dần. Tiền cho mượn và tiền mình trả nợ đi ra, tiền vay và tiền được trả đi vào số dư;
 * không phải chi tiêu hay thu nhập nên không vào hũ. Trả theo người thì trừ khoản cũ nhất trước.
 */

export type Debt = {
  id: number;
  direction: DebtDirection;
  person: string;
  amount: number;
  note: string | null;
  start_on: string;
  due_on: string | null;
  counts_balance: number;
  settled_at: number | null;
  created_at: number;
  paid: number;
  remaining: number;
};

const SELECT = `SELECT d.*, COALESCE((SELECT SUM(amount) FROM debt_payments p WHERE p.debt_id = d.id), 0) AS paid FROM debts d`;
const withRemaining = (rows: Omit<Debt, 'remaining'>[]): Debt[] => rows.map((d) => ({ ...d, remaining: Math.max(0, d.amount - d.paid) }));

/** Khoản còn nợ (cũ nhất trước), hoặc cả khoản đã xong (mới nhất trước) khi settled = true. */
export async function listDebts(env: Env, chat: number, settled = false) {
  const rows = await env.DB.prepare(
    settled
      ? `${SELECT} WHERE d.chat_id = ? AND d.settled_at IS NOT NULL ORDER BY d.settled_at DESC LIMIT 30`
      : `${SELECT} WHERE d.chat_id = ? AND d.settled_at IS NULL ORDER BY d.start_on, d.id`,
  )
    .bind(chat)
    .all<Omit<Debt, 'remaining'>>();
  return withRemaining(rows.results);
}

export async function getDebt(env: Env, chat: number, id: number) {
  const row = await env.DB.prepare(`${SELECT} WHERE d.id = ? AND d.chat_id = ?`).bind(id, chat).first<Omit<Debt, 'remaining'>>();
  return row ? withRemaining([row])[0] : null;
}

export async function addDebt(
  env: Env,
  chat: number,
  d: { direction: DebtDirection; person: string; amount: number; note?: string | null; start_on: string; due_on?: string | null; counts_balance?: boolean; message_id?: number | null },
) {
  return env.DB.prepare(
    `INSERT INTO debts (chat_id, direction, person, amount, note, start_on, due_on, counts_balance, message_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(chat, d.direction, d.person, d.amount, d.note || null, d.start_on, d.due_on ?? null, d.counts_balance === false ? 0 : 1, d.message_id ?? null, Date.now())
    .first<{ id: number }>();
}

/** Ghi một lần trả cho khoản nợ; trả đủ thì đánh dấu xong. amount = null: trả hết phần còn lại. Trả về số đã ghi. */
export async function payDebt(env: Env, chat: number, id: number, amount: number | null, today: string) {
  const debt = await getDebt(env, chat, id);
  if (!debt || debt.settled_at || debt.remaining <= 0) return 0;
  const pay = Math.min(debt.remaining, amount ?? debt.remaining);
  await env.DB.prepare('INSERT INTO debt_payments (debt_id, chat_id, amount, paid_on, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, chat, pay, today, Date.now())
    .run();
  if (pay >= debt.remaining) await env.DB.prepare('UPDATE debts SET settled_at = ? WHERE id = ? AND chat_id = ?').bind(Date.now(), id, chat).run();
  return pay;
}

/** Các khoản đang mở với người này (so tên không dấu, khớp đầu tên: "Nam" khớp "Nam béo"), cũ nhất trước. */
export async function openDebtsWith(env: Env, chat: number, direction: DebtDirection, person: string) {
  const key = plain(person);
  return (await listDebts(env, chat)).filter((d) => d.direction === direction && (plain(d.person) === key || plain(d.person).startsWith(`${key} `)));
}

/** Trả theo người: trừ dần từ khoản cũ nhất. amount = null: trả hết. */
export async function payPerson(env: Env, chat: number, direction: DebtDirection, person: string, amount: number | null, today: string) {
  let left = amount ?? Infinity;
  let paid = 0;
  for (const d of await openDebtsWith(env, chat, direction, person)) {
    if (left <= 0) break;
    const p = await payDebt(env, chat, d.id, Number.isFinite(left) ? left : null, today);
    paid += p;
    left -= p;
  }
  const remaining = (await openDebtsWith(env, chat, direction, person)).reduce((s, d) => s + d.remaining, 0);
  return { paid, remaining, overpaid: Number.isFinite(left) && left > 0 ? left : 0 };
}

export async function deleteDebt(env: Env, chat: number, id: number) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM debt_payments WHERE debt_id = ? AND chat_id = ?').bind(id, chat),
    env.DB.prepare('DELETE FROM debts WHERE id = ? AND chat_id = ?').bind(id, chat),
  ]);
}

/**
 * Tiền nợ đi / về sau thời điểm `since` (ms) để cộng vào số dư: cho mượn −, vay +, được trả +, mình trả −.
 * Khoản nợ cũ (counts_balance = 0) không tính tiền lúc tạo, nhưng các lần trả sau đó vẫn tính.
 */
export async function debtFlowSince(env: Env, chat: number, since: number) {
  const row = await env.DB.prepare(
    `SELECT
       COALESCE((SELECT SUM(CASE WHEN direction = 'borrow' THEN amount ELSE -amount END) FROM debts
                  WHERE chat_id = ?1 AND counts_balance = 1 AND created_at > ?2), 0)
     + COALESCE((SELECT SUM(CASE WHEN d.direction = 'lend' THEN p.amount ELSE -p.amount END)
                   FROM debt_payments p JOIN debts d ON d.id = p.debt_id
                  WHERE p.chat_id = ?1 AND p.created_at > ?2), 0) AS flow`,
  )
    .bind(chat, since)
    .first<{ flow: number }>();
  return row?.flow ?? 0;
}

/** Tổng người khác đang nợ mình / mình đang nợ. */
export function debtTotals(debts: Debt[]) {
  return {
    owedToMe: debts.filter((d) => d.direction === 'lend').reduce((s, d) => s + d.remaining, 0),
    iOwe: debts.filter((d) => d.direction === 'borrow').reduce((s, d) => s + d.remaining, 0),
  };
}

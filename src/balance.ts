import type { Env } from './ai';
import { averageIncome, jarBudgets, monthStatus } from './budget';
import { pendingCharges } from './credit';
import { getPayday, RECEIVED_ON_SQL } from './prefs';
import { addMonths, daysInMonth, monthOf, SPEND_JARS } from './core';
import { dueDay, listRecurring } from './recurring';

/**
 * Số dư tiền đang có và dự báo cuối tháng này / cuối tháng sau.
 * Quẹt thẻ tín dụng không trừ tiền mặt; tới khi thành chi tiêu (ngày 1 tháng sau) mới trừ, tức là lúc trả thẻ.
 */

export type BalanceSnapshot = { id: number; amount: number; day: string; created_at: number };

export async function setBalance(env: Env, chat: number, amount: number, today: string) {
  await env.DB.prepare('INSERT INTO balances (chat_id, amount, day, created_at) VALUES (?, ?, ?, ?)').bind(chat, amount, today, Date.now()).run();
}

/**
 * Số dư bây giờ = lần nhập gần nhất + thu nhập đã về tài khoản sau đó − chi tiêu sau đó
 * (khoản ghi lùi ngày trước lúc nhập coi như đã nằm trong số dư). Lương nhập trước ngày lương chỉ cộng khi tới ngày lương.
 */
export async function currentBalance(env: Env, chat: number, today: string, payday: number) {
  const snap = await env.DB.prepare('SELECT id, amount, day, created_at FROM balances WHERE chat_id = ? ORDER BY id DESC LIMIT 1')
    .bind(chat)
    .first<BalanceSnapshot>();
  if (!snap) return null;
  const [inc, exp] = await env.DB.batch([
    env.DB.prepare(
      `WITH i AS (SELECT amount, created_at, ${RECEIVED_ON_SQL} AS recv FROM incomes WHERE chat_id = ?)
       SELECT COALESCE(SUM(amount), 0) AS s FROM i WHERE recv <= ? AND (recv > ? OR (recv = ? AND created_at > ?))`,
    ).bind(payday, chat, today, snap.day, snap.day, snap.created_at),
    env.DB.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE chat_id = ? AND (spent_on > ? OR (spent_on = ? AND created_at > ?))',
    ).bind(chat, snap.day, snap.day, snap.created_at),
  ]);
  const incomeSince = (inc.results[0] as { s: number }).s;
  const spentSince = (exp.results[0] as { s: number }).s;
  return { snapshot: snap, incomeSince, spentSince, now: snap.amount + incomeSince - spentSince };
}

export type Forecast = {
  balance: NonNullable<Awaited<ReturnType<typeof currentBalance>>>;
  month: string;
  daysLeft: number;
  payday: number;
  /** Thu nhập sẽ về trước cuối tháng (lương đã nhập chưa tới ngày, hoặc lương dự kiến nếu chưa nhập). */
  incomePending: { note: string; amount: number; day: number; expected: boolean }[];
  /** Khoản cố định tháng này chưa trừ. */
  fixedPending: { item: string; amount: number; day: number }[];
  /** Dự kiến chi tiếp tới cuối tháng (ngoài khoản cố định). */
  moreSpend: number;
  moreSpendBasis: 'jars' | 'pace';
  endOfMonth: number;
  next: {
    month: string;
    income: number;
    creditDebt: number;
    spend: number;
    spendBasis: 'jars' | 'average';
    end: number;
  };
  incomeThisMonthMissing: boolean;
};

export async function forecast(env: Env, chat: number, today: string): Promise<Forecast | null> {
  const payday = await getPayday(env, chat);
  const balance = await currentBalance(env, chat, today, payday);
  if (!balance) return null;
  const month = monthOf(today);
  const nextMonth = addMonths(month, 1);
  const dayNow = Number(today.slice(8, 10));
  const [status, budgets, recurring, credit, income] = await Promise.all([
    monthStatus(env, chat, month, today),
    jarBudgets(env, chat),
    listRecurring(env, chat),
    pendingCharges(env, chat),
    averageIncome(env, chat),
  ]);
  const daysLeft = daysInMonth(month) - dayNow;
  const active = recurring.filter((r) => r.active === 1);
  const fixedPending = active
    .filter((r) => r.start_month <= month && r.last_month !== month && dueDay(r, month) > dayNow)
    .map((r) => ({ item: r.item, amount: r.amount, day: dueDay(r, month) }));
  const fixedPendingSum = fixedPending.reduce((s, r) => s + r.amount, 0);

  // Chi tiếp tới cuối tháng: phần còn lại của các hũ (nếu đã chia hũ), không thì theo tốc độ chi mỗi ngày của tháng này.
  const jarSpend = SPEND_JARS.reduce((s, k) => s + budgets[k], 0);
  let moreSpend: number;
  let moreSpendBasis: Forecast['moreSpendBasis'];
  if (jarSpend > 0) {
    moreSpend = Math.max(0, jarSpend - status.spent - fixedPendingSum);
    moreSpendBasis = 'jars';
  } else {
    moreSpend = dayNow > 0 ? Math.round((status.spent / dayNow) * daysLeft) : 0;
    moreSpendBasis = 'pace';
  }
  // Thu nhập tháng này chưa về: lương đã nhập nhưng chưa tới ngày lương; chưa nhập mà chưa tới ngày lương thì dùng lương TB.
  const pendingRows = await env.DB.prepare(
    `SELECT amount, note, ${RECEIVED_ON_SQL} AS recv FROM incomes WHERE chat_id = ? AND month = ? AND ${RECEIVED_ON_SQL} > ? ORDER BY recv`,
  )
    .bind(payday, chat, month, payday, today)
    .all<{ amount: number; note: string | null; recv: string }>();
  const incomePending: Forecast['incomePending'] = pendingRows.results.map((r) => ({
    note: r.note || 'Lương',
    amount: r.amount,
    day: Number(r.recv.slice(8, 10)),
    expected: false,
  }));
  if (status.income === 0 && dayNow < payday && income > 0) incomePending.push({ note: 'Lương (dự kiến)', amount: income, day: payday, expected: true });
  const endOfMonth = balance.now + incomePending.reduce((s, r) => s + r.amount, 0) - fixedPendingSum - moreSpend;

  // Tháng sau: lương TB − chi theo hũ (nợ thẻ sẽ thành chi tiêu tháng sau nên nằm trong hũ; nếu chưa chia hũ thì cộng riêng).
  const creditDebt = credit.filter((c) => monthOf(c.spent_on) < nextMonth).reduce((s, c) => s + c.amount, 0);
  const average = status.daysPassed > 0 ? Math.round((status.spent / status.daysPassed) * status.daysInMonth) : 0;
  // Nợ thẻ trả một lần vào ngày 1 tháng sau, tính riêng, cộng thêm với chi tiêu bình thường của tháng sau.
  const spend = jarSpend > 0 ? jarSpend : average;
  return {
    balance,
    month,
    daysLeft,
    payday,
    incomePending,
    fixedPending,
    moreSpend,
    moreSpendBasis,
    endOfMonth,
    next: { month: nextMonth, income, creditDebt, spend, spendBasis: jarSpend > 0 ? 'jars' : 'average', end: endOfMonth + income - creditDebt - spend },
    // Đã qua ngày lương mà tháng này chưa nhập lương.
    incomeThisMonthMissing: status.income === 0 && dayNow >= payday,
  };
}

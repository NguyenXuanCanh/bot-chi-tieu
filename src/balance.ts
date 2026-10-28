import type { Env } from './ai';
import { jarBudgets, periodStatus } from './budget';
import { billedMonth, pendingCharges } from './credit';
import { addDays, addMonths, daysBetween, formatDay, formatMonth, monthOf, monthPeriod, sameDayNextMonth, SPEND_JARS, type Period } from './core';
import { salaryState, type PendingIncome } from './period';
import { dueDay, listRecurring } from './recurring';

/**
 * Số dư tiền đang có và dự báo cuối kỳ này / cuối kỳ sau (kỳ = từ lần nhận lương, hoặc tháng lịch nếu chưa có).
 * Lương chỉ cộng vào số dư khi người dùng bấm nhận; khoản trả sau chỉ trừ khi thành chi tiêu (ngày 1 tháng sau hoặc trả sớm).
 */

export type BalanceSnapshot = { id: number; amount: number; day: string; created_at: number };

export async function setBalance(env: Env, chat: number, amount: number, today: string) {
  await env.DB.prepare('INSERT INTO balances (chat_id, amount, day, created_at) VALUES (?, ?, ?, ?)').bind(chat, amount, today, Date.now()).run();
}

/**
 * Số dư bây giờ = lần nhập gần nhất + thu nhập nhận sau lúc đó − chi tiêu sau lúc đó
 * (khoản ghi lùi ngày trước lúc nhập coi như đã nằm trong số dư).
 */
export async function currentBalance(env: Env, chat: number) {
  const snap = await env.DB.prepare('SELECT id, amount, day, created_at FROM balances WHERE chat_id = ? ORDER BY id DESC LIMIT 1')
    .bind(chat)
    .first<BalanceSnapshot>();
  if (!snap) return null;
  const [inc, exp] = await env.DB.batch([
    env.DB.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM incomes WHERE chat_id = ? AND received_at > ?').bind(chat, snap.created_at),
    env.DB.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE chat_id = ? AND (spent_on > ? OR (spent_on = ? AND created_at > ?))',
    ).bind(chat, snap.day, snap.day, snap.created_at),
  ]);
  const incomeSince = (inc.results[0] as { s: number }).s;
  const spentSince = (exp.results[0] as { s: number }).s;
  return { snapshot: snap, incomeSince, spentSince, now: snap.amount + incomeSince - spentSince };
}

/** Một dòng dự báo: + thu / − chi, có ngày (chi tiếp theo hũ thì không có ngày). */
export type ForecastLine = { label: string; amount: number; day?: string; expected?: boolean };
export type ForecastPeriod = { label: string; from: string; to: string; lines: ForecastLine[]; end: number };

export type Forecast = {
  balance: NonNullable<Awaited<ReturnType<typeof currentBalance>>>;
  period: Period;
  payday: number;
  current: ForecastPeriod;
  next: ForecastPeriod;
  /** Lương đã ghi chờ bấm nhận. */
  pendingSalary: PendingIncome[];
  /** Tới ngày lương mà chưa ghi lương nào: hiện nút nhận lương với số dự kiến. */
  salaryDue: { amount: number } | null;
};

export async function forecast(env: Env, chat: number, today: string): Promise<Forecast | null> {
  const balance = await currentBalance(env, chat);
  if (!balance) return null;
  const [salary, budgets, recurring, credit] = await Promise.all([
    salaryState(env, chat, today),
    jarBudgets(env, chat),
    listRecurring(env, chat),
    pendingCharges(env, chat),
  ]);
  const { period: cur, payday, average: avgIncome } = salary;
  const status = await periodStatus(env, chat, cur, today);
  const cycle = cur.kind === 'cycle';
  const nextFrom = addDays(cur.to, 1);
  const next: Period = cycle
    ? { key: nextFrom, kind: 'cycle', from: nextFrom, to: addDays(sameDayNextMonth(nextFrom), -1), open: true, label: '' }
    : monthPeriod(addMonths(monthOf(today), 1));

  // Lương: kỳ lương thì lương kế tiếp mở kỳ sau; tháng lịch thì về ngày lương của tháng (này nếu chưa nhận, và tháng sau).
  const salaries = salary.pending;
  const slots: { day: string }[] = [];
  if (!cycle) {
    const thisPayday = `${monthOf(today)}-${String(payday).padStart(2, '0')}`;
    if (!salary.gotSalary) slots.push({ day: thisPayday < today ? today : thisPayday });
    slots.push({ day: `${monthOf(next.from)}-${String(payday).padStart(2, '0')}` });
  } else {
    slots.push({ day: nextFrom });
  }
  const incomeLines: ForecastLine[] = slots.map((slot, i) => {
    const p = salaries[i];
    return p
      ? { label: `${p.note || 'Lương'} chờ nhận`, amount: p.amount, day: slot.day }
      : { label: 'Lương (dự kiến, TB các tháng)', amount: avgIncome, day: slot.day, expected: true };
  });

  // Khoản cố định chưa trừ trong khoảng (from, to].
  const fixedIn = (from: string, to: string): ForecastLine[] =>
    recurring
      .filter((r) => r.active === 1)
      .flatMap((r) => {
        const out: ForecastLine[] = [];
        for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) {
          const day = `${m}-${String(dueDay(r, m)).padStart(2, '0')}`;
          if (day <= from || day > to || m < r.start_month || r.last_month === m) continue;
          out.push({ label: `${r.item} (cố định)`, amount: -r.amount, day });
        }
        return out;
      });

  // Dư nợ trả sau: trừ vào ngày 1 tháng sau tháng mua.
  const creditByDay = new Map<string, number>();
  for (const c of credit) {
    const day = `${billedMonth(c.spent_on)}-01`;
    const at = day <= today ? addDays(today, 1) : day;
    creditByDay.set(at, (creditByDay.get(at) ?? 0) + c.amount);
  }
  const creditLines: ForecastLine[] = [...creditByDay].map(([day, amount]) => ({ label: 'Trả dư nợ trả sau', amount: -amount, day }));

  const inRange = (l: ForecastLine, from: string, to: string) => !!l.day && l.day >= from && l.day <= to;
  const jarSpend = SPEND_JARS.reduce((s, k) => s + budgets[k], 0);
  const daysLeft = Math.max(0, daysBetween(today, cur.to));
  const perDay = status.daysPassed > 0 ? status.spent / status.daysPassed : 0;

  // Kỳ này: từ mai tới hết kỳ. Chi tiếp = phần còn lại của các hũ (đã gồm khoản cố định), không thì theo mức chi mỗi ngày.
  const fixedA = fixedIn(today, cur.to);
  const fixedASum = -fixedA.reduce((s, l) => s + l.amount, 0);
  const spendA = jarSpend > 0 ? Math.max(0, jarSpend - status.spent - fixedASum) : Math.round(perDay * daysLeft);
  const linesA: ForecastLine[] = [
    ...incomeLines.filter((l) => inRange(l, today, cur.to)),
    ...fixedA,
    ...creditLines.filter((l) => inRange(l, addDays(today, 1), cur.to)),
    { label: jarSpend > 0 ? 'Chi tiếp (phần còn lại của các hũ)' : 'Chi tiếp (theo mức chi mỗi ngày)', amount: -spendA },
  ].sort((a, b) => (a.day ?? '9').localeCompare(b.day ?? '9'));
  const endA = balance.now + linesA.reduce((s, l) => s + l.amount, 0);

  // Kỳ sau: lương + chi theo hũ (hũ đã gồm khoản cố định) + dư nợ trả sau rơi vào kỳ đó.
  const spendB = jarSpend > 0 ? jarSpend : Math.round(perDay * (daysBetween(next.from, next.to) + 1));
  const linesB: ForecastLine[] = [
    ...incomeLines.filter((l) => inRange(l, next.from, next.to)),
    ...creditLines.filter((l) => inRange(l, next.from, next.to)),
    { label: jarSpend > 0 ? 'Chi theo hũ' : 'Chi như kỳ này', amount: -spendB },
  ].sort((a, b) => (a.day ?? '9').localeCompare(b.day ?? '9'));
  const endB = endA + linesB.reduce((s, l) => s + l.amount, 0);

  const label = (p: Period, end: string) => (p.kind === 'cycle' ? `Cuối kỳ (${formatDay(end)})` : `Cuối tháng ${formatMonth(monthOf(end))}`);

  return {
    balance,
    period: cur,
    payday,
    current: { label: label(cur, cur.to), from: today, to: cur.to, lines: linesA.filter((l) => l.amount !== 0 || l.expected), end: endA },
    next: { label: label(next, next.to), from: next.from, to: next.to, lines: linesB.filter((l) => l.amount !== 0 || l.expected), end: endB },
    pendingSalary: salaries,
    salaryDue: salary.due,
  };
}

import type { Env } from './ai';
import { averageIncome } from './budget';
import { addDays, cyclePeriods, monthOf, monthPeriod, periodOf, sameDayNextMonth, type Period } from './core';
import { getPayday } from './prefs';

/**
 * Kỳ chi tiêu: bấm "+lương" (nhận lương) thì hôm đó là đầu tháng mới; kỳ chạy tới hết ngày trước lần nhận lương sau.
 * Chưa nhận lương lần nào thì tính theo tháng lịch như cũ.
 */

export async function cycleStarts(env: Env, chat: number) {
  const rows = await env.DB.prepare('SELECT start_on FROM cycles WHERE chat_id = ? ORDER BY start_on DESC').bind(chat).all<{ start_on: string }>();
  return rows.results.map((r) => r.start_on);
}

/** Kỳ chứa ngày `day` (mặc định hôm nay). */
export async function periodFor(env: Env, chat: number, today: string, day = today): Promise<Period> {
  return periodOf(await cycleStarts(env, chat), day, today);
}

/** Kỳ theo key (ngày bắt đầu kỳ, hoặc "YYYY-MM"); không hợp lệ thì kỳ hiện tại. */
export async function periodByKey(env: Env, chat: number, key: string | null, today: string): Promise<Period> {
  const starts = await cycleStarts(env, chat);
  if (key && /^\d{4}-\d{2}$/.test(key)) return monthPeriod(key);
  return cyclePeriods(starts, today).find((p) => p.key === key) ?? periodOf(starts, today, today);
}

/** Danh sách kỳ để chuyển qua lại (mới nhất trước): các kỳ lương, hoặc 12 tháng gần nhất nếu chưa có kỳ nào. */
export async function listPeriods(env: Env, chat: number, today: string): Promise<Period[]> {
  const cycles = cyclePeriods(await cycleStarts(env, chat), today);
  if (cycles.length) return cycles.slice(0, 24);
  const out: Period[] = [];
  let month = monthOf(today);
  for (let i = 0; i < 12; i++) {
    out.push(monthPeriod(month));
    const [y, m] = month.split('-').map(Number);
    month = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  }
  return out;
}

// ---------- Nhận lương ----------

export type PendingIncome = { id: number; month: string; amount: number; note: string | null; created_at: number };

const SALARY_NOTE = /^lương/i;
export const isSalary = (note: string | null) => !note || SALARY_NOTE.test(note.trim());

/** Lương đã ghi nhưng chưa bấm nhận (cũ nhất trước). */
export const pendingIncomes = (env: Env, chat: number) =>
  env.DB.prepare('SELECT id, month, amount, note, created_at FROM incomes WHERE chat_id = ? AND received_at IS NULL ORDER BY id')
    .bind(chat)
    .all<PendingIncome>()
    .then((r) => r.results);

export type Received = { amount: number; note: string; started: Period | null; previous: Period | null };

/** Bắt đầu kỳ mới từ `today`; trả về kỳ vừa kết thúc (để gửi tổng kết). Đã bắt đầu hôm nay rồi thì thôi. */
async function startCycle(env: Env, chat: number, today: string) {
  const before = await periodFor(env, chat, today);
  const inserted = await env.DB.prepare('INSERT OR IGNORE INTO cycles (chat_id, start_on, created_at) VALUES (?, ?, ?) RETURNING start_on')
    .bind(chat, today, Date.now())
    .first();
  if (!inserted) return { started: null, previous: null };
  const started = await periodFor(env, chat, today);
  // Kỳ (hoặc tháng lịch) đang chạy kết thúc hôm qua.
  return { started, previous: before.from < today ? { ...before, open: false, to: addDays(today, -1) } : null };
}

/**
 * Bấm "+lương": khoản thu được cộng vào số dư từ lúc này; là lương thì hôm nay thành đầu tháng mới.
 * incomeId = khoản đã ghi chờ nhận; không có thì ghi mới `amount`.
 */
export async function receiveIncome(
  env: Env,
  chat: number,
  today: string,
  target: { incomeId: number } | { amount: number; note?: string },
): Promise<Received | null> {
  let row: { amount: number; note: string | null } | null;
  if ('incomeId' in target) {
    // Có điều kiện: bấm 2 lần không cộng 2 lần.
    row = await env.DB.prepare('UPDATE incomes SET received_at = ? WHERE id = ? AND chat_id = ? AND received_at IS NULL RETURNING amount, note')
      .bind(Date.now(), target.incomeId, chat)
      .first<{ amount: number; note: string | null }>();
  } else {
    // Nút lương dự kiến: hôm nay đã nhận lương rồi thì không ghi thêm.
    const already = await env.DB.prepare(
      "SELECT 1 FROM incomes WHERE chat_id = ? AND received_at IS NOT NULL AND date(received_at / 1000, 'unixepoch', '+7 hours') = ? AND (note IS NULL OR note LIKE 'Lương%')",
    )
      .bind(chat, today)
      .first();
    row = already
      ? null
      : await env.DB.prepare('INSERT INTO incomes (chat_id, month, amount, note, created_at, received_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING amount, note')
          .bind(chat, monthOf(today), target.amount, target.note ?? 'Lương', Date.now(), Date.now())
          .first<{ amount: number; note: string | null }>();
  }
  if (!row) return null;
  const { started, previous } = isSalary(row.note) ? await startCycle(env, chat, today) : { started: null, previous: null };
  return { amount: row.amount, note: row.note || 'Lương', started, previous };
}

/**
 * Trạng thái lương để hiện nút "+lương": các khoản lương chờ nhận, hoặc (chưa ghi khoản nào mà đã tới ngày lương)
 * một nút với lương trung bình. Kỳ lương: tới ngày = cùng ngày tháng sau của lần nhận trước; tháng lịch: ngày lương trong Cài đặt.
 */
export async function salaryState(env: Env, chat: number, today: string) {
  const [period, pending, avg, payday] = await Promise.all([
    periodFor(env, chat, today),
    pendingIncomes(env, chat),
    averageIncome(env, chat),
    getPayday(env, chat),
  ]);
  const salaries = pending.filter((p) => isSalary(p.note));
  // Tháng lịch: đã nhận lương của tháng này chưa (thưởng không tính).
  const gotSalary =
    period.kind === 'cycle' ||
    !!(await env.DB.prepare('SELECT 1 FROM incomes WHERE chat_id = ? AND month = ? AND received_at IS NOT NULL AND (note IS NULL OR note LIKE ?)')
      .bind(chat, monthOf(today), 'Lương%')
      .first());
  const due = period.kind === 'cycle' ? today >= sameDayNextMonth(period.from) : !gotSalary && Number(today.slice(8, 10)) >= payday;
  return { pending: salaries, due: !salaries.length && due && avg > 0 ? { amount: avg } : null, period, payday, average: avg, gotSalary };
}

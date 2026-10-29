import { linkedChats } from './accounts';
import type { Env } from './ai';
import { forecast } from './balance';
import { listDebts } from './debts';
import { activeGoal, goalProgress, jarLine, periodStatus, reviewMonth } from './budget';
import { addMonths, emojiOf, formatDay, formatVnd, formatVndFull, monthOf, monthPeriod, sameDayNextMonth, type Period } from './core';
import { cycleStarts, listPeriods, salaryState } from './period';
import { getPref } from './prefs';
import { esc, send, type Buttons } from './telegram';

export { getPref, setPref } from './prefs';

/** Báo cáo tự động: tổng kết kỳ (khi nhận lương, hoặc ngày 1 nếu tính theo tháng lịch), nhắc ngày lương, nhắc ghi chi tiêu 21h. */

/** Chat Telegram được gửi báo cáo/nhắc: các tài khoản đã liên kết (và ALLOWED_CHAT_IDS). */
export const allowedChats = (env: Env) => linkedChats(env);

const titleOf = (p: Period) =>
  p.kind === 'cycle' || p.to !== monthPeriod(p.key).to ? `${p.kind === 'cycle' ? 'Kỳ' : `Tháng ${p.key.slice(5).replace(/^0/, '')}`} ${formatDay(p.from)} → ${formatDay(p.to)}` : p.label;

/** Kỳ liền trước để so sánh: kỳ lương trước đó, hoặc tháng lịch trước. */
async function previousOf(env: Env, chat: number, p: Period, today: string): Promise<Period | null> {
  if (p.kind === 'month') return monthPeriod(addMonths(p.key, -1));
  const periods = await listPeriods(env, chat, today);
  return periods.find((x) => x.to < p.from) ?? null;
}

/** Tổng kết một kỳ (kỳ lương hoặc tháng lịch). Null nếu kỳ không có thu chi. */
export async function periodReport(env: Env, chat: number, period: Period, today: string, footer?: string) {
  const s = await periodStatus(env, chat, period, today);
  if (s.spent === 0 && s.income === 0) return null;
  const prevPeriod = await previousOf(env, chat, period, today);
  const before = prevPeriod ? await periodStatus(env, chat, prevPeriod, today) : null;
  const lines = [`📆 <b>Tổng kết · ${titleOf(period)}</b>`, ''];
  lines.push(`💰 Thu nhập: ${s.income ? formatVnd(s.income) : 'chưa có'} · Đã chi: <b>${formatVnd(s.spent)}</b>`);
  if (s.saved !== null) {
    const rate = Math.round((s.saved / s.income) * 100);
    lines.push(`${s.saved >= 0 ? '🐷 Để dành được' : '⚠️ Chi vượt thu'}: <b>${formatVnd(Math.abs(s.saved))}</b> (${Math.abs(rate)}% thu nhập)`);
  }
  if (before && before.spent > 0) {
    const change = Math.round(((s.spent - before.spent) / before.spent) * 100);
    lines.push(`${change > 0 ? '📈' : '📉'} So với ${titleOf(prevPeriod!).toLowerCase()}: ${change > 0 ? '+' : ''}${change}% (${formatVnd(before.spent)})`);
  }
  if (s.jars.some((j) => j.budget > 0)) lines.push('', '<b>Các hũ</b>', ...s.jars.map(jarLine));
  if (s.topItems.length) {
    lines.push('', '<b>Khoản lớn nhất</b>', ...s.topItems.slice(0, 3).map((i) => `${emojiOf(i.category)} ${esc(i.item)}: ${formatVnd(i.total)}`));
  }

  const goal = await activeGoal(env, chat);
  if (goal) {
    const p = await goalProgress(env, chat, goal, today);
    lines.push(
      '',
      `🎯 <b>${esc(goal.title)}</b>: ${formatVnd(p.saved)} / ${formatVnd(goal.target)} (${p.percent}%)` +
        (p.monthsLeft > 0 && p.saved < goal.target ? ` · còn ${p.monthsLeft} tháng, mỗi tháng cần ${formatVnd(p.needFromNow)}` : ''),
    );
  }
  const f = await forecast(env, chat, today);
  if (f) lines.push(`💵 Đang có: <b>${formatVndFull(f.balance.now)}</b> · ${f.current.label.toLowerCase()} dự kiến còn ${formatVnd(f.current.end)}`);

  try {
    const review = await reviewMonth(env, s);
    if (review) lines.push('', '🧐 <b>Nhận xét</b>', esc(review));
  } catch (error) {
    console.error('[report] AI lỗi:', error);
  }
  if (footer) lines.push('', footer);
  return lines.join('\n').slice(0, 4000);
}

/** Tổng kết tháng lịch. */
export const monthlyReport = (env: Env, chat: number, month: string, today: string) => periodReport(env, chat, monthPeriod(month), today);

/** Ngày 1: tổng kết tháng trước cho người tính theo tháng lịch (người dùng kỳ lương nhận tổng kết lúc bấm nhận lương). */
export async function sendMonthlyReports(env: Env, today: string) {
  if (today.slice(8, 10) !== '01') return;
  const month = addMonths(monthOf(today), -1);
  for (const chat of await allowedChats(env)) {
    if ((await cycleStarts(env, chat)).length) continue;
    const text = await periodReport(env, chat, monthPeriod(month), today, 'Tháng mới bắt đầu! Lương về thì bấm nút nhận (hoặc /luong) · xem hũ: /hu');
    if (text) await send(env, chat, text);
  }
}

/** 21h: hôm nay chưa ghi khoản nào (tự ghi bằng tin nhắn / ảnh / trả sau) thì nhắc. */
export async function remindIdle(env: Env, today: string) {
  for (const chat of await allowedChats(env)) {
    if ((await getPref(env, chat, 'remind')) === '0') continue;
    const row = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM expenses WHERE chat_id = ?1 AND spent_on = ?2 AND message_id IS NOT NULL)
            + (SELECT COUNT(*) FROM credit_charges WHERE chat_id = ?1 AND spent_on = ?2) AS n`,
    )
      .bind(chat, today)
      .first<{ n: number }>();
    if ((row?.n ?? 0) > 0) continue;
    await send(
      env,
      chat,
      '🕘 Hôm nay chưa ghi khoản chi nào. Có tiêu gì không? Nhắn như <code>cơm 35k, grab 50k</code> hoặc gửi ảnh hóa đơn.\n<i>Tắt nhắc: /nhac tat</i>',
    );
  }
}

/**
 * Ngày lương (00:05): chưa nhận lương thì nhắc, kèm nút "+lương" (bấm = cộng vào số dư + bắt đầu tháng mới).
 * Kỳ lương: ngày dự kiến = cùng ngày tháng sau của lần nhận trước; tháng lịch: ngày lương trong Cài đặt.
 */
export async function remindPayday(env: Env, today: string) {
  for (const chat of await allowedChats(env)) {
    const state = await salaryState(env, chat, today);
    const day = state.period.kind === 'cycle' ? sameDayNextMonth(state.period.from) : `${monthOf(today)}-${String(state.payday).padStart(2, '0')}`;
    // Chỉ nhắc đúng ngày lương, và chỉ khi còn lương để nhận.
    if (today !== day || (!state.pending.length && !state.due)) continue;
    const buttons: Buttons = state.pending.length
      ? state.pending.map((p) => [{ text: `✅ Đã nhận +${formatVnd(p.amount)} (${p.note || 'Lương'})`, data: `inc:${p.id}` }])
      : [[{ text: `✅ Đã nhận lương +${formatVnd(state.due!.amount)}`, data: `sal:${state.due!.amount}` }]];
    await send(
      env,
      chat,
      [
        `💰 Hôm nay (${formatDay(today)}) là ngày nhận lương. Lương về chưa?`,
        'Bấm nút khi tiền đã về: lương được cộng vào số dư và hôm đó là đầu tháng mới.',
        `<i>Số khác thì gõ <code>/luong 25tr</code>. Chưa về thì cứ để đó, khi nào về hãy bấm.</i>`,
      ].join('\n'),
      buttons,
    );
  }
}

/** Ngày hẹn trả nợ (00:05): nhắc kèm nút "đã trả đủ". */
export async function remindDebts(env: Env, today: string) {
  for (const chat of await allowedChats(env)) {
    const due = (await listDebts(env, chat)).filter((d) => d.due_on === today);
    if (!due.length) continue;
    await send(
      env,
      chat,
      [
        `📒 <b>Hôm nay (${formatDay(today)}) tới hạn trả nợ</b>`,
        ...due.map((d) =>
          d.direction === 'lend' ? `• <b>${esc(d.person)}</b> hẹn trả bạn ${formatVnd(d.remaining)}` : `• Bạn hẹn trả <b>${esc(d.person)}</b> ${formatVnd(d.remaining)}`,
        ),
        '<i>Trả một phần thì nhắn, VD <code>Nam trả 200k</code>.</i>',
      ].join('\n'),
      due.map((d) => [
        { text: d.direction === 'lend' ? `✅ ${d.person} đã trả ${formatVnd(d.remaining)}` : `✅ Đã trả ${d.person} ${formatVnd(d.remaining)}`, data: `debt:${d.id}` },
      ]),
    );
  }
}

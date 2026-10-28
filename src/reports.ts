import { linkedChats } from './accounts';
import type { Env } from './ai';
import { forecast } from './balance';
import { activeGoal, goalProgress, jarLine, monthStatus, reviewMonth } from './budget';
import { addMonths, emojiOf, formatMonth, formatVnd, formatVndFull, monthOf } from './core';
import { getPref, getPayday } from './prefs';
import { esc, send } from './telegram';

export { getPref, setPref } from './prefs';

/** Báo cáo tự động: tổng kết tháng (ngày 1) và nhắc ghi chi tiêu lúc 21h. */

/** Chat Telegram được gửi báo cáo/nhắc: các tài khoản đã liên kết (và ALLOWED_CHAT_IDS). */
export const allowedChats = (env: Env) => linkedChats(env);

/** Tổng kết tháng `month` (gửi ngày 1 tháng sau). */
export async function monthlyReport(env: Env, chat: number, month: string, today: string) {
  const [s, before] = await Promise.all([monthStatus(env, chat, month, today), monthStatus(env, chat, addMonths(month, -1), today)]);
  if (s.spent === 0 && s.income === 0) return null;
  const lines = [`📆 <b>Tổng kết tháng ${formatMonth(month)}</b>`, ''];
  lines.push(
    `💰 Thu nhập: ${s.income ? formatVnd(s.income) : 'chưa nhập'} · Đã chi: <b>${formatVnd(s.spent)}</b>`,
  );
  if (s.saved !== null) {
    const rate = Math.round((s.saved / s.income) * 100);
    lines.push(`${s.saved >= 0 ? '🐷 Để dành được' : '⚠️ Chi vượt thu'}: <b>${formatVnd(Math.abs(s.saved))}</b> (${Math.abs(rate)}% lương)`);
  }
  if (before.spent > 0) {
    const change = Math.round(((s.spent - before.spent) / before.spent) * 100);
    lines.push(`${change > 0 ? '📈' : '📉'} So với tháng ${formatMonth(before.month)}: ${change > 0 ? '+' : ''}${change}% (${formatVnd(before.spent)})`);
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
  if (f) lines.push(`💵 Đang có: <b>${formatVndFull(f.balance.now)}</b> · dự kiến cuối tháng ${formatMonth(f.month)} còn ${formatVnd(f.endOfMonth)}`);

  try {
    const review = await reviewMonth(env, s);
    if (review) lines.push('', '🧐 <b>Nhận xét</b>', esc(review));
  } catch (error) {
    console.error('[report] AI lỗi:', error);
  }
  if (month === addMonths(monthOf(today), -1)) lines.push('', `Tháng mới bắt đầu! Nhập lương khi nhận: /luong · xem hũ: /hu`);
  return lines.join('\n').slice(0, 4000);
}

/** Ngày 1: gửi tổng kết tháng trước cho mọi chat. */
export async function sendMonthlyReports(env: Env, today: string) {
  if (today.slice(8, 10) !== '01') return;
  const month = addMonths(monthOf(today), -1);
  for (const chat of await allowedChats(env)) {
    const text = await monthlyReport(env, chat, month, today);
    if (text) await send(env, chat, text);
  }
}

/** 21h: hôm nay chưa ghi khoản nào (tự ghi bằng tin nhắn / ảnh / quẹt thẻ) thì nhắc. */
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

/** Ngày lương (00:05): tháng này chưa nhập lương thì nhắc. */
export async function remindPayday(env: Env, today: string) {
  for (const chat of await allowedChats(env)) {
    if (Number(today.slice(8, 10)) !== (await getPayday(env, chat))) continue;
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM incomes WHERE chat_id = ? AND month = ?').bind(chat, monthOf(today)).first<{ n: number }>();
    if ((row?.n ?? 0) > 0) continue;
    await send(env, chat, `💰 Hôm nay ngày nhận lương tháng ${formatMonth(monthOf(today))}. Nhận rồi thì gõ <code>/luong 25tr</code> (số thật) để cộng vào số dư và chia hũ.`);
  }
}

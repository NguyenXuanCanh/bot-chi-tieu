import { answerQuestion, type Env } from './ai';
import { addDays, formatVnd, monthOf, vnDate } from './core';

type Row = [string, string, string, number, string, string];

/** Tổng + theo danh mục + 3 khoản lớn nhất của một kỳ, để AI đọc số thay vì tự cộng. */
function periodLine(name: string, from: string, to: string, rows: Row[]) {
  const inRange = rows.filter((r) => r[0] >= from && r[0] <= to);
  const total = inRange.reduce((s, r) => s + r[3], 0);
  if (!total) return `- ${name} (${from} → ${to}): 0đ`;
  const byCat = new Map<string, number>();
  for (const r of inRange) byCat.set(r[2], (byCat.get(r[2]) ?? 0) + r[3]);
  const cats = [...byCat].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${formatVnd(v)}`);
  const top = [...inRange].sort((a, b) => b[3] - a[3]).slice(0, 3).map((r) => `${r[1]} ${formatVnd(r[3])} (${r[0].slice(8)}/${r[0].slice(5, 7)})`);
  return `- ${name} (${from} → ${to}): tổng ${formatVnd(total)}, ${inRange.length} khoản. Theo danh mục: ${cats.join('; ')}. Lớn nhất: ${top.join('; ')}`;
}

/** Trả lời câu hỏi về chi tiêu 3 tháng gần nhất (dùng chung cho lệnh /hoi và ô hỏi đáp trên trang admin). Null nếu chưa có dữ liệu. */
export async function askSpending(env: Env, chat: number, question: string): Promise<string | null> {
  const today = vnDate(Date.now());
  const rows = await env.DB.prepare(
    `SELECT e.spent_on, e.item, e.category, e.amount, COALESCE(e.city, ''), COALESCE(t.city, '')
       FROM expenses e LEFT JOIN trips t ON t.id = e.trip_id
      WHERE e.chat_id = ? AND e.spent_on >= ? ORDER BY e.spent_on`,
  )
    .bind(chat, vnDate(Date.now(), -92))
    .raw<Row>();
  if (rows.length === 0) return null;

  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // thứ Hai = 0
  const monthStart = `${monthOf(today)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const summary = [
    `Hôm nay là ${today} (tuần bắt đầu từ thứ Hai).`,
    periodLine('Hôm nay', today, today, rows),
    periodLine('7 ngày qua', addDays(today, -6), today, rows),
    periodLine('Tuần này', addDays(today, -weekday), today, rows),
    periodLine('Tháng này', monthStart, today, rows),
    periodLine('Tháng trước', `${monthOf(lastMonthEnd)}-01`, lastMonthEnd, rows),
  ].join('\n');
  const context = rows.map((r) => r.join(' | ')).join('\n');
  try {
    return await answerQuestion(env, question, summary, context);
  } catch (error) {
    console.error('[ask] AI lỗi:', error);
    return 'AI đang bận, bạn thử hỏi lại sau ít phút nhé.';
  }
}

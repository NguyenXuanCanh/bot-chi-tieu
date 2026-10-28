import { askJson, askText, type Env } from './ai';
import { pendingCharges } from './credit';
import { listRecurring } from './recurring';
import {
  addDays,
  addMonths,
  CATEGORY_NAMES,
  DEFAULT_CATEGORY_JAR,
  daysBetween,
  daysInMonth,
  formatMonth,
  formatVnd,
  isJar,
  JAR_KEYS,
  JARS,
  jarInfo,
  monthOf,
  monthsBetween,
  SPEND_JARS,
  type Category,
  type JarKey,
} from './core';

/**
 * Hũ chi tiêu (lương chia theo hũ) và mục tiêu tiết kiệm. Dùng chung cho bot và trang admin.
 * Mọi con số do code tính; AI chỉ nhận xét / chọn cắt giảm dựa trên số đã tính sẵn.
 */

// ---------- Cấu hình hũ ----------

export async function categoryJarMap(env: Env, chat: number): Promise<Record<string, JarKey>> {
  const rows = await env.DB.prepare('SELECT category, jar FROM category_jars WHERE chat_id = ?').bind(chat).all<{ category: string; jar: string }>();
  const map: Record<string, JarKey> = { ...DEFAULT_CATEGORY_JAR };
  for (const r of rows.results) if (isJar(r.jar) && r.jar !== 'tiet_kiem') map[r.category] = r.jar;
  return map;
}

export const jarOfCategory = (map: Record<string, JarKey>, category: string): JarKey => map[category] ?? 'tieu_xai';

export async function jarBudgets(env: Env, chat: number): Promise<Record<JarKey, number>> {
  const rows = await env.DB.prepare('SELECT jar, amount FROM jars WHERE chat_id = ?').bind(chat).all<{ jar: string; amount: number }>();
  const out = Object.fromEntries(JAR_KEYS.map((k) => [k, 0])) as Record<JarKey, number>;
  for (const r of rows.results) if (isJar(r.jar)) out[r.jar] = r.amount;
  return out;
}

export async function setJarBudgets(env: Env, chat: number, amounts: Partial<Record<JarKey, number>>) {
  const entries = Object.entries(amounts).filter(([k, v]) => isJar(k) && Number.isFinite(v) && (v as number) >= 0);
  await env.DB.batch(
    entries.map(([jar, amount]) =>
      env.DB.prepare('INSERT INTO jars (chat_id, jar, amount) VALUES (?, ?, ?) ON CONFLICT(chat_id, jar) DO UPDATE SET amount = excluded.amount').bind(
        chat,
        jar,
        Math.round(amount as number),
      ),
    ),
  );
}

export async function addIncome(env: Env, chat: number, month: string, amount: number, note: string | null) {
  await env.DB.prepare('INSERT INTO incomes (chat_id, month, amount, note, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(chat, month, amount, note, Date.now())
    .run();
}

// ---------- Tình hình một tháng ----------

export type JarStatus = { key: JarKey; name: string; emoji: string; budget: number; spent: number };
export type MonthStatus = {
  month: string;
  income: number;
  incomes: { id: number; amount: number; note: string | null }[];
  spent: number;
  /** Lương − chi; null nếu tháng này chưa nhập lương. */
  saved: number | null;
  jars: JarStatus[];
  byCategory: { category: string; jar: JarKey; total: number }[];
  topItems: { item: string; category: string; total: number }[];
  daysInMonth: number;
  /** Số ngày đã qua của tháng (tháng cũ = cả tháng, tháng sau = 0). */
  daysPassed: number;
};

export async function monthStatus(env: Env, chat: number, month: string, today: string): Promise<MonthStatus> {
  const from = `${month}-01`;
  const to = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const [incomes, cats, top] = await env.DB.batch([
    env.DB.prepare('SELECT id, amount, note FROM incomes WHERE chat_id = ? AND month = ? ORDER BY id').bind(chat, month),
    env.DB.prepare('SELECT category, SUM(amount) AS total FROM expenses WHERE chat_id = ? AND spent_on BETWEEN ? AND ? GROUP BY category ORDER BY total DESC').bind(
      chat,
      from,
      to,
    ),
    env.DB.prepare(
      'SELECT item, category, SUM(amount) AS total FROM expenses WHERE chat_id = ? AND spent_on BETWEEN ? AND ? GROUP BY lower(item) ORDER BY total DESC LIMIT 8',
    ).bind(chat, from, to),
  ]);
  const [map, budgets] = await Promise.all([categoryJarMap(env, chat), jarBudgets(env, chat)]);
  const byCategory = (cats.results as { category: string; total: number }[]).map((c) => ({ ...c, jar: jarOfCategory(map, c.category) }));
  const income = (incomes.results as { amount: number }[]).reduce((s, r) => s + r.amount, 0);
  const spent = byCategory.reduce((s, c) => s + c.total, 0);
  const jars = JARS.map((j) => ({
    key: j.key,
    name: j.name,
    emoji: j.emoji,
    budget: budgets[j.key],
    // Hũ tiết kiệm "chi" = số tiền thực sự còn dư trong tháng.
    spent: j.key === 'tiet_kiem' ? Math.max(0, income - spent) : byCategory.filter((c) => c.jar === j.key).reduce((s, c) => s + c.total, 0),
  }));
  const current = monthOf(today);
  const total = daysInMonth(month);
  return {
    month,
    income,
    incomes: incomes.results as MonthStatus['incomes'],
    spent,
    saved: income > 0 ? income - spent : null,
    jars,
    byCategory,
    topItems: top.results as MonthStatus['topItems'],
    daysInMonth: total,
    daysPassed: month < current ? total : month > current ? 0 : Number(today.slice(8, 10)),
  };
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Một dòng tình trạng hũ, VD "🎉 Tiêu xài: 3,2tr / 5tr (64%)". */
export function jarLine(j: JarStatus) {
  if (j.key === 'tiet_kiem') return `${j.emoji} ${j.name}: đang dư ${formatVnd(j.spent)} / mục tiêu ${formatVnd(j.budget)}`;
  if (!j.budget) return `${j.emoji} ${j.name}: ${formatVnd(j.spent)} (chưa đặt mức)`;
  const over = j.spent > j.budget ? ` ⚠️ vượt ${formatVnd(j.spent - j.budget)}` : '';
  return `${j.emoji} ${j.name}: ${formatVnd(j.spent)} / ${formatVnd(j.budget)} (${pct(j.spent, j.budget)}%)${over}`;
}

function monthFacts(s: MonthStatus) {
  return [
    `Tháng ${formatMonth(s.month)}, đã qua ${s.daysPassed}/${s.daysInMonth} ngày.`,
    `Thu nhập: ${s.income ? formatVnd(s.income) : 'chưa nhập'}. Đã chi: ${formatVnd(s.spent)}.${s.saved !== null ? ` Còn dư: ${formatVnd(s.saved)}.` : ''}`,
    'Các hũ (đã chi / mức đặt / % dùng):',
    ...s.jars.filter((j) => j.key !== 'tiet_kiem').map((j) => `- ${j.name}: ${formatVnd(j.spent)} / ${j.budget ? formatVnd(j.budget) : 'chưa đặt'}${j.budget ? ` / ${pct(j.spent, j.budget)}%` : ''}`),
    `- Tiết kiệm: muốn để dành ${formatVnd(s.jars[3].budget)}, hiện còn dư ${s.saved !== null ? formatVnd(s.saved) : 'không rõ (chưa nhập lương)'}`,
    'Theo danh mục: ' + s.byCategory.map((c) => `${c.category} ${formatVnd(c.total)} (hũ ${jarInfo(c.jar).name})`).join('; '),
    'Khoản lớn nhất: ' + s.topItems.map((i) => `${i.item} ${formatVnd(i.total)}`).join('; '),
  ].join('\n');
}

/**
 * Sau khi ghi chi tiêu: hũ nào vừa chạm 80% hoặc vượt 100% thì trả về mốc vừa chạm (để AI nhắc), không thì null.
 * `added` = số tiền vừa ghi thêm vào từng hũ.
 */
export function crossedThreshold(j: JarStatus, added: number): 80 | 100 | null {
  if (!j.budget || added <= 0) return null;
  const before = j.spent - added;
  if (before <= j.budget && j.spent > j.budget) return 100;
  if (before < j.budget * 0.8 && j.spent >= j.budget * 0.8) return 80;
  return null;
}

/** AI nhắc ngắn khi một hũ chạm 80% / vượt mức. */
export async function jarWarning(env: Env, s: MonthStatus, j: JarStatus, level: 80 | 100, justAdded: string) {
  const left = s.daysInMonth - s.daysPassed;
  const prompt = `Bạn là trợ lý tài chính cá nhân, nói tiếng Việt thân mật, thẳng thắn, không phán xét.
Người dùng vừa ghi: ${justAdded}.
Hũ "${j.name}" ${level === 100 ? `đã VƯỢT mức: chi ${formatVnd(j.spent)} / mức ${formatVnd(j.budget)}` : `đã dùng ${pct(j.spent, j.budget)}%: ${formatVnd(j.spent)} / ${formatVnd(j.budget)}`}, tháng còn ${left} ngày.

${monthFacts(s)}

Viết đúng 2 câu ngắn (tối đa 260 ký tự, không markdown, không emoji): câu 1 nhận xét vì sao hũ này lên nhanh (dựa vào khoản lớn), câu 2 gợi ý cụ thể cho ${left} ngày còn lại (VD mỗi ngày nên tiêu tối đa bao nhiêu, hoặc lấy bù từ hũ nào). Chỉ dùng số liệu ở trên.`;
  try {
    const text = await askText(env, prompt, 'jar-warning');
    if (text) return text.slice(0, 400);
  } catch (error) {
    console.error('[jar-warning] lỗi:', error);
  }
  const room = Math.max(0, j.budget - j.spent);
  return level === 100
    ? `Hũ ${j.name} đã vượt ${formatVnd(j.spent - j.budget)}. Phần vượt sẽ lấy vào tiền tiết kiệm tháng này.`
    : `Hũ ${j.name} còn ${formatVnd(room)} cho ${left} ngày, tức khoảng ${formatVnd(room / Math.max(left, 1))}/ngày.`;
}

/** AI đánh giá cả tháng (lệnh /danhgia và nút trên trang admin). */
export async function reviewMonth(env: Env, s: MonthStatus) {
  if (s.spent === 0 && s.income === 0) return 'Tháng này chưa có dữ liệu thu chi để đánh giá.';
  const prompt = `Bạn là trợ lý tài chính cá nhân, nói tiếng Việt thân mật, thẳng thắn.
Đánh giá việc chi tiêu theo hũ của người dùng dựa trên số liệu sau (đã tính sẵn, KHÔNG tự tính lại số khác):

${monthFacts(s)}

Viết tối đa 8 dòng, viết số tiền dạng 850k, 1,2tr và phần trăm dạng 85%, không markdown (không dùng ** hay #), mỗi ý một dòng bắt đầu bằng "• ":
- Hũ nào vượt hoặc sắp vượt mức (so với số ngày đã qua: dùng ${pct(s.daysPassed, s.daysInMonth)}% thời gian của tháng), hũ nào đang ổn.
- ${s.income ? 'Có đạt mục tiêu tiết kiệm của tháng không (so phần còn dư với mức muốn để dành).' : 'Chưa nhập lương nên chưa biết tiết kiệm được bao nhiêu: nhắc nhập bằng lệnh /luong.'}
- 2-3 gợi ý cụ thể, nêu tên khoản chi thật trong dữ liệu.`;
  return askText(env, prompt, 'review');
}

// ---------- Mục tiêu tiết kiệm ----------

export type Goal = {
  id: number;
  title: string;
  target: number;
  saved_before: number;
  start_month: string;
  deadline: string;
  plan: string | null;
  plan_at: number | null;
  created_at: number;
};

export type PlanBudget = { category: string; jar: JarKey; current: number; target: number; action: 'giữ' | 'giảm' | 'cắt'; reason: string };
export type GoalPlan = {
  summary: string;
  budgets: PlanBudget[];
  tips: string[];
  income: number;
  need: number;
  currentSpend: number;
  plannedSpend: number;
  plannedSaving: number;
  dataDays: number;
  source: 'ai' | 'rule';
};

export const activeGoal = (env: Env, chat: number) =>
  env.DB.prepare('SELECT * FROM goals WHERE chat_id = ? AND active = 1 ORDER BY id DESC LIMIT 1').bind(chat).first<Goal>();

export async function createGoal(env: Env, chat: number, g: { title: string; target: number; deadline: string; saved_before: number }, today: string) {
  await env.DB.prepare('UPDATE goals SET active = 0 WHERE chat_id = ? AND active = 1').bind(chat).run();
  return env.DB.prepare(
    'INSERT INTO goals (chat_id, title, target, saved_before, start_month, deadline, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
  )
    .bind(chat, g.title, g.target, g.saved_before, monthOf(today), g.deadline, Date.now())
    .first<Goal>();
}

export type GoalProgress = {
  totalMonths: number;
  /** Tháng còn lại, tính cả tháng này. */
  monthsLeft: number;
  /** Mỗi tháng cần để dành (chia đều từ lúc đặt mục tiêu). */
  needPerMonth: number;
  /** Từ giờ tới hạn, mỗi tháng cần để dành bao nhiêu. */
  needFromNow: number;
  saved: number;
  percent: number;
  months: { month: string; income: number; spent: number; saved: number | null }[];
  missingIncome: string[];
};

/** Đã để dành = tiền có sẵn + (lương − chi) của từng tháng từ lúc đặt mục tiêu. Tháng chưa nhập lương thì bỏ qua. */
export async function goalProgress(env: Env, chat: number, goal: Goal, today: string): Promise<GoalProgress> {
  const current = monthOf(today);
  const last = current < goal.deadline ? current : goal.deadline;
  const [inc, exp] = await env.DB.batch([
    env.DB.prepare('SELECT month, SUM(amount) AS total FROM incomes WHERE chat_id = ? AND month BETWEEN ? AND ? GROUP BY month').bind(chat, goal.start_month, last),
    env.DB.prepare(
      'SELECT substr(spent_on, 1, 7) AS month, SUM(amount) AS total FROM expenses WHERE chat_id = ? AND spent_on BETWEEN ? AND ? GROUP BY month',
    ).bind(chat, `${goal.start_month}-01`, `${last}-31`),
  ]);
  const incomeOf = new Map((inc.results as { month: string; total: number }[]).map((r) => [r.month, r.total]));
  const spentOf = new Map((exp.results as { month: string; total: number }[]).map((r) => [r.month, r.total]));
  const months: GoalProgress['months'] = [];
  for (let m = goal.start_month; m <= last; m = addMonths(m, 1)) {
    const income = incomeOf.get(m) ?? 0;
    const spent = spentOf.get(m) ?? 0;
    months.push({ month: m, income, spent, saved: income > 0 ? income - spent : null });
  }
  const saved = goal.saved_before + months.reduce((s, m) => s + (m.saved ?? 0), 0);
  const totalMonths = monthsBetween(goal.start_month, goal.deadline) + 1;
  const monthsLeft = Math.max(0, monthsBetween(current, goal.deadline) + 1);
  // Tháng này đã có lương thì phần dư đã nằm trong `saved`, chỉ chia cho các tháng sau.
  const currentCounted = months.some((m) => m.month === current && m.saved !== null);
  const toCome = currentCounted ? monthsLeft - 1 : monthsLeft;
  return {
    totalMonths,
    monthsLeft,
    needPerMonth: Math.ceil(Math.max(0, goal.target - goal.saved_before) / totalMonths),
    needFromNow: Math.ceil(Math.max(0, goal.target - saved) / Math.max(1, toCome)),
    saved,
    percent: Math.max(0, Math.min(100, pct(saved, goal.target))),
    months,
    missingIncome: months.filter((m) => m.saved === null).map((m) => m.month),
  };
}

/** Chi tiêu trung bình mỗi tháng theo danh mục, tính từ 90 ngày gần nhất. */
async function spendingProfile(env: Env, chat: number, today: string) {
  const since = addDays(today, -89);
  const rows = await env.DB.prepare(
    'SELECT category, SUM(amount) AS total, MIN(spent_on) AS first FROM expenses WHERE chat_id = ? AND spent_on BETWEEN ? AND ? GROUP BY category',
  )
    .bind(chat, since, today)
    .all<{ category: string; total: number; first: string }>();
  if (rows.results.length === 0) return { dataDays: 0, categories: [] as { category: string; monthly: number }[] };
  const first = rows.results.reduce((min, r) => (r.first < min ? r.first : min), today);
  const dataDays = daysBetween(first, today) + 1;
  // Chưa đủ 1 tháng thì lấy đúng số đã chi, không nhân lên (tiền nhà 5tr trong 2 ngày không có nghĩa là 75tr/tháng).
  const scale = dataDays >= 30 ? 30 / dataDays : 1;
  return {
    dataDays,
    categories: rows.results.map((r) => ({ category: r.category, monthly: Math.round((r.total * scale) / 1000) * 1000 })).sort((a, b) => b.monthly - a.monthly),
  };
}

/** Lương trung bình 3 tháng gần nhất có nhập lương. */
export async function averageIncome(env: Env, chat: number) {
  const rows = await env.DB.prepare('SELECT month, SUM(amount) AS total FROM incomes WHERE chat_id = ? GROUP BY month ORDER BY month DESC LIMIT 3')
    .bind(chat)
    .all<{ total: number }>();
  if (rows.results.length === 0) return 0;
  return Math.round(rows.results.reduce((s, r) => s + r.total, 0) / rows.results.length);
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    budgets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CATEGORY_NAMES },
          target: { type: 'integer' },
          action: { type: 'string', enum: ['giữ', 'giảm', 'cắt'] },
          reason: { type: 'string' },
        },
        required: ['category', 'target', 'action', 'reason'],
      },
    },
    tips: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'budgets', 'tips'],
};

export class PlanError extends Error {}

/** AI lập kế hoạch chi tiêu mỗi tháng để đạt mục tiêu; lưu vào goals.plan. */
export async function planGoal(env: Env, chat: number, goal: Goal, today: string): Promise<GoalPlan> {
  const [income, profile, progress, map, budgets, recurring] = await Promise.all([
    averageIncome(env, chat),
    spendingProfile(env, chat, today),
    goalProgress(env, chat, goal, today),
    categoryJarMap(env, chat),
    jarBudgets(env, chat),
    listRecurring(env, chat).then((rows) => rows.filter((r) => r.active === 1)),
  ]);
  const creditDebt = (await pendingCharges(env, chat)).reduce((sum, c) => sum + c.amount, 0);
  if (!income) throw new PlanError('Chưa có lương để lập kế hoạch. Nhập lương trước: /luong 25tr');
  const need = progress.needFromNow;
  const currentSpend = profile.categories.reduce((s, c) => s + c.monthly, 0);
  const budgetLimit = Math.max(0, income - need);
  const currentOf = new Map(profile.categories.map((c) => [c.category, c.monthly]));

  const prompt = `Bạn là chuyên gia tài chính cá nhân người Việt. Lập kế hoạch chi tiêu MỖI THÁNG để người dùng đạt mục tiêu tiết kiệm.

Mục tiêu: "${goal.title}" — cần ${formatVnd(goal.target)} trước hết tháng ${formatMonth(goal.deadline)}. Đã có ${formatVnd(progress.saved)}, còn ${progress.monthsLeft} tháng (tính cả tháng này).
=> Mỗi tháng cần để dành: ${formatVnd(need)}.
Lương trung bình: ${formatVnd(income)}/tháng. => Tổng chi tối đa mỗi tháng: ${formatVnd(budgetLimit)}.
${profile.dataDays >= 30 ? `Chi tiêu trung bình mỗi tháng (từ ${profile.dataDays} ngày dữ liệu)` : `Chi tiêu tháng này tới giờ (mới ${profile.dataDays} ngày dữ liệu, chưa phải cả tháng; khoản cố định như tiền nhà là theo tháng)`}: tổng ${formatVnd(currentSpend)}.
Khoản chi cố định hàng tháng (tự trừ mỗi tháng, đã nằm trong danh mục tương ứng, KHÔNG đề xuất cắt trừ khi thật sự bắt buộc): ${recurring.map((r) => `${r.item} ${formatVnd(r.amount)} (${r.category})`).join('; ') || 'không có'}.
${creditDebt ? `Nợ thẻ tín dụng tháng này: ${formatVnd(creditDebt)} — CHƯA nằm trong số chi ở trên, sẽ tính thêm vào chi tiêu THÁNG SAU (chỉ một lần), nên tháng sau để dành được ít hơn.
` : ''}Hũ người dùng tự đặt mỗi tháng: ${JARS.map((j) => `${j.name} ${budgets[j.key] ? formatVnd(budgets[j.key]) : 'chưa đặt'}`).join(', ')}.
${profile.categories.map((c) => `- ${c.category} (hũ ${jarInfo(jarOfCategory(map, c.category)).name}): ${c.monthly} VND`).join('\n') || '- chưa có dữ liệu chi tiêu'}

Yêu cầu:
- budgets: mỗi danh mục đang có chi tiêu ở trên một dòng: target = số VND mỗi tháng nên chi (số nguyên, làm tròn nghìn), action = "giữ" (target = hiện tại), "giảm" hoặc "cắt" (target = 0), reason = 1 câu ngắn vì sao.
- Tổng target KHÔNG vượt ${budgetLimit} VND. Ưu tiên cắt/giảm hũ tiêu xài và nạp game trước, giữ chi tiêu bắt buộc (ăn uống cơ bản, đi lại, hóa đơn, sức khỏe) trừ khi bắt buộc phải giảm.
- Nếu không thể đạt mục tiêu dù cắt hết khoản không bắt buộc, nói thẳng trong summary và đề xuất lùi hạn hoặc giảm số tiền.
- summary: 2-3 câu tiếng Việt, tips: 2-4 mẹo cụ thể theo khoản chi thật của người dùng. Không markdown.`;

  let plan: Omit<GoalPlan, 'income' | 'need' | 'currentSpend' | 'plannedSpend' | 'plannedSaving' | 'dataDays'>;
  try {
    const raw = await askJson<{ summary?: string; budgets?: { category?: string; target?: number; action?: string; reason?: string }[]; tips?: string[] }>(
      env,
      prompt,
      PLAN_SCHEMA,
      'plan',
    );
    const seen = new Set<string>();
    const budgets: PlanBudget[] = [];
    for (const b of raw.budgets ?? []) {
      if (!b?.category || !CATEGORY_NAMES.includes(b.category as Category) || seen.has(b.category)) continue;
      seen.add(b.category);
      const current = currentOf.get(b.category) ?? 0;
      const target = Math.max(0, Math.round(Number(b.target) / 1000) * 1000 || 0);
      budgets.push({
        category: b.category,
        jar: jarOfCategory(map, b.category),
        current,
        target,
        action: target === 0 ? 'cắt' : target < current ? 'giảm' : 'giữ',
        reason: String(b.reason ?? '').slice(0, 200),
      });
    }
    // Danh mục AI bỏ sót thì giữ nguyên.
    for (const c of profile.categories) {
      if (!seen.has(c.category)) budgets.push({ category: c.category, jar: jarOfCategory(map, c.category), current: c.monthly, target: c.monthly, action: 'giữ', reason: '' });
    }
    plan = {
      summary: String(raw.summary ?? '').slice(0, 600),
      budgets,
      tips: (raw.tips ?? []).map((t) => String(t).slice(0, 200)).slice(0, 4),
      source: 'ai',
    };
  } catch (error) {
    console.error('[plan] AI lỗi, dùng kế hoạch theo quy tắc:', error);
    plan = rulePlan(profile.categories, map, budgetLimit);
  }
  plan.budgets.sort((a, b) => SPEND_JARS.indexOf(a.jar) - SPEND_JARS.indexOf(b.jar) || b.current - a.current);
  const plannedSpend = plan.budgets.reduce((s, b) => s + b.target, 0);
  const full: GoalPlan = { ...plan, income, need, currentSpend, plannedSpend, plannedSaving: income - plannedSpend, dataDays: profile.dataDays };
  await env.DB.prepare('UPDATE goals SET plan = ?, plan_at = ? WHERE id = ?').bind(JSON.stringify(full), Date.now(), goal.id).run();
  return full;
}

/** Dự phòng khi AI lỗi: cắt hũ nạp game rồi giảm đều hũ tiêu xài cho tới khi vừa ngân sách; giữ chi tiêu bắt buộc. */
function rulePlan(categories: { category: string; monthly: number }[], map: Record<string, JarKey>, limit: number) {
  const budgets: PlanBudget[] = categories.map((c) => ({
    category: c.category,
    jar: jarOfCategory(map, c.category),
    current: c.monthly,
    target: c.monthly,
    action: 'giữ' as const,
    reason: '',
  }));
  let over = budgets.reduce((s, b) => s + b.target, 0) - limit;
  for (const jar of ['game', 'tieu_xai'] as JarKey[]) {
    if (over <= 0) break;
    const group = budgets.filter((b) => b.jar === jar);
    const sum = group.reduce((s, b) => s + b.target, 0);
    if (!sum) continue;
    const ratio = Math.max(0, (sum - over) / sum);
    for (const b of group) {
      b.target = Math.round((b.current * ratio) / 1000) * 1000;
      b.action = b.target === 0 ? 'cắt' : 'giảm';
      b.reason = `Giảm hũ ${jarInfo(jar).name} để đủ tiền tiết kiệm.`;
    }
    over -= sum - group.reduce((s, b) => s + b.target, 0);
  }
  return {
    summary:
      over > 0
        ? 'Dù cắt hết khoản tiêu xài và nạp game vẫn chưa đủ. Nên lùi hạn hoặc giảm số tiền mục tiêu.'
        : 'Giữ chi tiêu bắt buộc, giảm hũ nạp game và tiêu xài theo bảng dưới để đạt mục tiêu.',
    budgets,
    tips: [],
    source: 'rule' as const,
  };
}

export const parsePlan = (goal: Goal): GoalPlan | null => {
  try {
    return goal.plan ? (JSON.parse(goal.plan) as GoalPlan) : null;
  } catch {
    return null;
  }
};

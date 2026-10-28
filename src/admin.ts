import type { Env } from './ai';
import {
  activeGoal,
  addIncome,
  categoryJarMap,
  createGoal,
  goalProgress,
  jarBudgets,
  monthStatus,
  parsePlan,
  PlanError,
  planGoal,
  reviewMonth,
  setJarBudgets,
  type Goal,
} from './budget';
import {
  chatKey,
  checkPassword,
  confirmLink,
  createUser,
  findUser,
  hashPassword,
  issueToken,
  safeEqual,
  startLink,
  unlink,
  userFromToken,
  validateCredentials,
  type User,
} from './accounts';
import { askSpending } from './ask';
import { botUsername, esc, send } from './telegram';
import { forecast, setBalance } from './balance';
import { getPayday, setPref } from './prefs';
import { dueDay } from './recurring';
import { payEarly, pendingCharges } from './credit';
import { addRecurring, chargeOne, listRecurring, type Recurring } from './recurring';
import { addDays, addMonths, CATEGORY_NAMES, isPaylater, PAYLATER, daysBetween, isJar, isMonth, JARS, monthOf, toCategory, vnDate, type JarKey } from './core';

/**
 * API cho trang admin: /admin/api/*.
 * Đăng nhập bằng tài khoản (tên + mật khẩu) -> token ký HMAC (hạn 7 ngày) gửi qua header Authorization: Bearer.
 * Mỗi tài khoản chỉ thấy dữ liệu của mình: chat Telegram đã liên kết, hoặc -id nếu chưa liên kết.
 */

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const bad = (message: string, status = 400) => json({ error: message }, status);
const slow = () => new Promise((r) => setTimeout(r, 800)); // làm chậm việc dò mật khẩu

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/admin\/api/, '');
  const method = request.method;

  const body = method === 'GET' || method === 'DELETE' ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>);

  // ---------- Không cần đăng nhập ----------
  if (path === '/config' && method === 'GET') {
    return json({ signupNeedsCode: !!env.SIGNUP_CODE, botUsername: await botUsername(env) });
  }
  if (path === '/login' && method === 'POST') {
    const user = typeof body.username === 'string' ? await findUser(env, body.username) : null;
    if (!user || typeof body.password !== 'string' || !(await checkPassword(body.password, user.password_hash))) {
      await slow();
      return bad('Sai tên đăng nhập hoặc mật khẩu', 401);
    }
    await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(Date.now(), user.id).run();
    return json({ token: await issueToken(env, user) });
  }
  if (path === '/signup' && method === 'POST') {
    if (env.SIGNUP_CODE && !(typeof body.invite === 'string' && safeEqual(body.invite.trim(), env.SIGNUP_CODE))) {
      await slow();
      return bad('Mã mời không đúng', 403);
    }
    const invalid = validateCredentials(body.username, body.password);
    if (invalid) return bad(invalid);
    if (await findUser(env, body.username as string)) return bad('Tên đăng nhập đã có người dùng');
    const user = await createUser(env, body.username as string, body.password as string);
    return json({ token: await issueToken(env, user!) });
  }

  const user = await userFromToken(env, request.headers.get('Authorization'));
  if (!user) return bad('Phiên đăng nhập hết hạn', 401);
  const chat = chatKey(user);

  // ---------- Tài khoản ----------
  if (path === '/account' && method === 'GET') {
    const pending = await env.DB.prepare('SELECT chat_id, expires_at FROM link_codes WHERE user_id = ?')
      .bind(user.id)
      .first<{ chat_id: number; expires_at: number }>();
    return json({
      username: user.username,
      chat_id: user.chat_id,
      pending_chat_id: pending && pending.expires_at > Date.now() ? pending.chat_id : null,
      bot_username: await botUsername(env),
      created_at: user.created_at,
    });
  }
  if (path === '/account/link/start' && method === 'POST') {
    const chatId = Number(String(body.chat_id ?? '').trim());
    if (!Number.isInteger(chatId) || chatId <= 0) return bad('ID Telegram là một dãy số, bot gửi cho bạn khi nhắn /start');
    const result = await startLink(env, user, chatId);
    if ('error' in result) return bad(result.error);
    const sent = await send(
      env,
      chatId,
      `🔐 Mã liên kết tài khoản <b>${esc(user.username)}</b> trên trang Chi Tiêu: <code>${result.code}</code>\nMã dùng được 10 phút. Nếu không phải bạn yêu cầu, bỏ qua tin này.`,
    );
    if (!sent) {
      await env.DB.prepare('DELETE FROM link_codes WHERE user_id = ?').bind(user.id).run();
      return bad('Bot không nhắn được tới ID này. Kiểm tra lại ID, và nhớ mở bot bấm Start trước.');
    }
    return json({ ok: true });
  }
  if (path === '/account/link/confirm' && method === 'POST') {
    const result = await confirmLink(env, user, String(body.code ?? ''));
    if ('error' in result) return bad(result.error);
    await send(env, result.chatId, `✅ Đã liên kết với tài khoản <b>${esc(user.username)}</b>. Giờ bạn ghi chi tiêu ở đây là thấy trên trang quản lý. Gõ /help để xem cách dùng.`);
    return json({ ok: true, chat_id: result.chatId });
  }
  if (path === '/account/unlink' && method === 'POST') {
    await unlink(env, user);
    return json({ ok: true });
  }
  if (path === '/account/password' && method === 'POST') {
    if (typeof body.current !== 'string' || !(await checkPassword(body.current, user.password_hash))) {
      await slow();
      return bad('Mật khẩu hiện tại không đúng');
    }
    const invalid = validateCredentials(user.username, body.password);
    if (invalid) return bad(invalid);
    const updated = await env.DB.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ? RETURNING *')
      .bind(await hashPassword(body.password as string), user.id)
      .first<User>();
    return json({ token: await issueToken(env, updated!) });
  }

  let m: RegExpMatchArray | null;

  if (path === '/meta' && method === 'GET') {
    const cities = await env.DB.prepare(
      "SELECT city, COUNT(*) AS n FROM expenses WHERE chat_id = ? AND city IS NOT NULL AND city <> '' GROUP BY city ORDER BY n DESC",
    )
      .bind(chat)
      .all<{ city: string; n: number }>();
    const range = await env.DB.prepare('SELECT MIN(spent_on) AS first, MAX(spent_on) AS last FROM expenses WHERE chat_id = ?')
      .bind(chat)
      .first<{ first: string | null; last: string | null }>();
    return json({ categories: CATEGORY_NAMES, cities: cities.results.map((c) => c.city), today: vnDate(Date.now()), ...range });
  }

  if (path === '/summary' && method === 'GET') return json(await summary(env, chat, url.searchParams));

  if (path === '/expenses' && method === 'GET') return json(await listExpenses(env, chat, url.searchParams));
  if (path === '/expenses' && method === 'POST') return createExpense(env, chat, body);
  if ((m = path.match(/^\/expenses\/(\d+)$/))) {
    const id = Number(m[1]);
    if (method === 'PATCH') return updateExpense(env, chat, id, body);
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM expenses WHERE id = ? AND chat_id = ?').bind(id, chat).run();
      await dropEmptyTrips(env, chat);
      return json({ ok: true });
    }
  }

  if (path === '/trips' && method === 'GET') return json(await listTrips(env, chat));
  if ((m = path.match(/^\/trips\/(\d+)$/))) {
    const id = Number(m[1]);
    if (method === 'GET') return tripDetail(env, chat, id);
    if (method === 'PATCH') return updateTrip(env, chat, id, body);
    if (method === 'DELETE') {
      // Xóa chuyến nhưng giữ các khoản chi (chỉ bỏ liên kết).
      await env.DB.batch([
        env.DB.prepare('UPDATE expenses SET trip_id = NULL WHERE trip_id = ? AND chat_id = ?').bind(id, chat),
        env.DB.prepare('DELETE FROM trips WHERE id = ? AND chat_id = ?').bind(id, chat),
        env.DB.prepare('UPDATE settings SET active_trip_id = NULL WHERE chat_id = ? AND active_trip_id = ?').bind(chat, id),
      ]);
      return json({ ok: true });
    }
  }
  if ((m = path.match(/^\/trips\/(\d+)\/merge$/)) && method === 'POST') return mergeTrip(env, chat, Number(m[1]), body);

  if (path === '/settings' && method === 'GET') {
    const row = await env.DB.prepare('SELECT home_city, active_trip_id FROM settings WHERE chat_id = ?').bind(chat).first();
    return json({
      home_city: (row?.home_city as string) || env.DEFAULT_HOME_CITY,
      active_trip_id: row?.active_trip_id ?? null,
      payday: await getPayday(env, chat),
    });
  }
  if (path === '/settings' && method === 'PATCH') {
    if (body.payday !== undefined) {
      const payday = Number(body.payday);
      if (!Number.isInteger(payday) || payday < 1 || payday > 28) return bad('Ngày lương từ 1 đến 28');
      await setPref(env, chat, 'payday', String(payday));
      if (body.home_city === undefined) return json({ ok: true });
    }
    const home = typeof body.home_city === 'string' ? body.home_city.trim().slice(0, 60) : '';
    if (!home) return bad('Nhập thành phố nhà');
    await env.DB.prepare(
      'INSERT INTO settings (chat_id, home_city) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET home_city = excluded.home_city',
    )
      .bind(chat, home)
      .run();
    return json({ ok: true });
  }

  if (path === '/export.csv' && method === 'GET') return exportCsv(env, chat);

  // ---------- Lương & hũ ----------
  const today = vnDate(Date.now());
  if (path === '/budget' && method === 'GET') {
    const month = isMonth(url.searchParams.get('month')) ? url.searchParams.get('month')! : monthOf(today);
    const [status, mapping] = await Promise.all([monthStatus(env, chat, month, today), categoryJarMap(env, chat)]);
    return json({ status, mapping, jars: JARS, categories: CATEGORY_NAMES });
  }
  if (path === '/budget/review' && method === 'POST') {
    const month = isMonth(body.month) ? body.month : monthOf(today);
    return json({ text: await reviewMonth(env, await monthStatus(env, chat, month, today)) });
  }
  if (path === '/incomes' && method === 'POST') {
    const amount = Math.round(Number(body.amount));
    if (!isMonth(body.month)) return bad('Tháng không hợp lệ');
    if (!(amount > 0) || amount > 10_000_000_000) return bad('Số tiền không hợp lệ');
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 60) : 'Lương';
    await addIncome(env, chat, body.month, amount, note);
    return json({ ok: true });
  }
  if ((m = path.match(/^\/incomes\/(\d+)$/)) && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM incomes WHERE id = ? AND chat_id = ?').bind(Number(m[1]), chat).run();
    return json({ ok: true });
  }
  if (path === '/jars' && method === 'PUT') {
    const amounts: Partial<Record<JarKey, number>> = {};
    for (const [key, value] of Object.entries(body)) {
      const n = Math.round(Number(value));
      if (!isJar(key)) continue;
      if (!(n >= 0) || n > 10_000_000_000) return bad('Số tiền hũ không hợp lệ');
      amounts[key] = n;
    }
    await setJarBudgets(env, chat, amounts);
    return json({ budgets: await jarBudgets(env, chat) });
  }
  if (path === '/category-jars' && method === 'PUT') {
    const rows = Object.entries(body).filter(([c, j]) => CATEGORY_NAMES.includes(c as never) && isJar(j) && j !== 'tiet_kiem');
    await env.DB.batch(
      rows.map(([category, jar]) =>
        env.DB.prepare(
          'INSERT INTO category_jars (chat_id, category, jar) VALUES (?, ?, ?) ON CONFLICT(chat_id, category) DO UPDATE SET jar = excluded.jar',
        ).bind(chat, category, jar),
      ),
    );
    return json({ mapping: await categoryJarMap(env, chat) });
  }

  // ---------- Chi cố định hàng tháng ----------
  if (path === '/recurring' && method === 'GET') return json({ rows: await listRecurring(env, chat), month: monthOf(today) });
  if (path === '/recurring' && method === 'POST') {
    const value = readRecurring(body);
    if ('error' in value) return bad(value.error);
    const result = await addRecurring(env, chat, value, today, body.charge_now === true);
    return json(result);
  }
  if ((m = path.match(/^\/recurring\/(\d+)$/))) {
    const id = Number(m[1]);
    if (method === 'PATCH') {
      const value = readRecurring(body);
      if ('error' in value) return bad(value.error);
      const active = body.active === false || body.active === 0 ? 0 : 1;
      await env.DB.prepare('UPDATE recurring SET item = ?, amount = ?, category = ?, day = ?, active = ? WHERE id = ? AND chat_id = ?')
        .bind(value.item, value.amount, value.category, value.day, active, id, chat)
        .run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      // Chỉ xóa khoản cố định; các lần đã trừ (chi tiêu) vẫn giữ.
      await env.DB.prepare('DELETE FROM recurring WHERE id = ? AND chat_id = ?').bind(id, chat).run();
      return json({ ok: true });
    }
  }
  if ((m = path.match(/^\/recurring\/(\d+)\/charge$/)) && method === 'POST') {
    const row = await env.DB.prepare('SELECT * FROM recurring WHERE id = ? AND chat_id = ?').bind(Number(m[1]), chat).first<Recurring>();
    if (!row) return bad('Không tìm thấy khoản cố định', 404);
    return json({ charged: await chargeOne(env, row, today) });
  }

  if (path === '/ask' && method === 'POST') {
    const question = typeof body.question === 'string' ? body.question.trim().slice(0, 300) : '';
    if (!question) return bad('Nhập câu hỏi');
    const answer = await askSpending(env, chat, question);
    return json({ answer: answer ?? 'Chưa có dữ liệu chi tiêu để trả lời.' });
  }
  if (path === '/dashboard' && method === 'GET') return json(await dashboard(env, chat, today));

  // ---------- Số dư ----------
  if (path === '/balance' && method === 'GET') return json({ forecast: await forecast(env, chat, today) });
  if (path === '/balance' && method === 'POST') {
    const amount = Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || Math.abs(amount) > 100_000_000_000) return bad('Số tiền không hợp lệ');
    await setBalance(env, chat, amount, today);
    return json({ forecast: await forecast(env, chat, today) });
  }

  // ---------- Thẻ tín dụng ----------
  if (path === '/credit' && method === 'GET') return json({ rows: await pendingCharges(env, chat) });
  if (path === '/credit' && method === 'POST') {
    const value = readExpense({ ...body, trip_id: null });
    if (!value.value) return bad(value.error!);
    const v = value.value;
    const provider = isPaylater(body.provider) ? body.provider : 'card';
    await env.DB.prepare('INSERT INTO credit_charges (chat_id, amount, item, category, spent_on, created_at, provider) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(chat, v.amount, v.item, v.category, v.spent_on, Date.now(), provider)
      .run();
    return json({ ok: true });
  }
  if (path === '/credit/pay' && method === 'POST') {
    // amount bỏ trống = trả hết.
    const amount = body.amount === undefined || body.amount === null || body.amount === '' ? null : Math.round(Number(body.amount));
    if (amount !== null && !(amount > 0)) return bad('Số tiền không hợp lệ');
    // provider bỏ trống = trả mọi nguồn.
    const result = await payEarly(env, chat, amount, today, isPaylater(body.provider) ? body.provider : undefined);
    if (!result.paid) return bad('Không có nợ thẻ để trả');
    return json(result);
  }
  if ((m = path.match(/^\/credit\/(\d+)$/)) && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM credit_charges WHERE id = ? AND chat_id = ? AND settled = 0').bind(Number(m[1]), chat).run();
    return json({ ok: true });
  }

  // ---------- Mục tiêu tiết kiệm ----------
  if (path === '/goal' && method === 'GET') {
    const goal = await activeGoal(env, chat);
    return json(goal ? await goalView(env, chat, goal, today) : { goal: null });
  }
  if (path === '/goal' && method === 'POST') {
    const target = Math.round(Number(body.target));
    const savedBefore = Math.round(Number(body.saved_before) || 0);
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : 'Tiết kiệm';
    if (!(target > 0) || target > 100_000_000_000) return bad('Số tiền mục tiêu không hợp lệ');
    if (!(savedBefore >= 0) || savedBefore >= target) return bad('Tiền đã có phải nhỏ hơn mục tiêu');
    if (!isMonth(body.deadline) || body.deadline < monthOf(today)) return bad('Chọn tháng hoàn thành từ tháng này trở đi');
    const goal = await createGoal(env, chat, { title, target, deadline: body.deadline, saved_before: savedBefore }, today);
    return json(await goalView(env, chat, goal!, today, true));
  }
  if (path === '/goal/plan' && method === 'POST') {
    const goal = await activeGoal(env, chat);
    if (!goal) return bad('Chưa có mục tiêu', 404);
    return json(await goalView(env, chat, goal, today, true));
  }
  if (path === '/goal' && method === 'DELETE') {
    await env.DB.prepare('UPDATE goals SET active = 0 WHERE chat_id = ? AND active = 1').bind(chat).run();
    return json({ ok: true });
  }
  return bad('Không có API này', 404);
}

/** Tình hình tài chính "bây giờ" cho trang Tổng quan: hũ, số dư, mục tiêu, nợ thẻ, khoản sắp trừ, 6 tháng gần nhất. */
async function dashboard(env: Env, chat: number, today: string) {
  const month = monthOf(today);
  const from = addMonths(month, -5);
  const [status, f, goal, credit, recurring, history] = await Promise.all([
    monthStatus(env, chat, month, today),
    forecast(env, chat, today),
    activeGoal(env, chat),
    pendingCharges(env, chat),
    listRecurring(env, chat),
    env.DB.batch([
      env.DB.prepare('SELECT month, SUM(amount) AS total FROM incomes WHERE chat_id = ? AND month >= ? GROUP BY month').bind(chat, from),
      env.DB.prepare(
        'SELECT substr(spent_on, 1, 7) AS month, SUM(amount) AS total FROM expenses WHERE chat_id = ? AND spent_on >= ? GROUP BY month',
      ).bind(chat, `${from}-01`),
    ]),
  ]);
  const incomeOf = new Map((history[0].results as { month: string; total: number }[]).map((r) => [r.month, r.total]));
  const spentOf = new Map((history[1].results as { month: string; total: number }[]).map((r) => [r.month, r.total]));
  const months: { month: string; income: number; spent: number; saved: number | null }[] = [];
  for (let m = from; m <= month; m = addMonths(m, 1)) {
    const income = incomeOf.get(m) ?? 0;
    const spent = spentOf.get(m) ?? 0;
    months.push({ month: m, income, spent, saved: income ? income - spent : null });
  }
  const dayNow = Number(today.slice(8, 10));
  const upcoming = recurring
    .filter((r) => r.active === 1 && r.start_month <= month && r.last_month !== month && dueDay(r, month) > dayNow)
    .map((r) => ({ id: r.id, item: r.item, amount: r.amount, category: r.category, day: dueDay(r, month) }))
    .sort((a, b) => a.day - b.day);
  const progress = goal ? await goalProgress(env, chat, goal, today) : null;
  return {
    today,
    status,
    forecast: f,
    goal: goal && progress ? { title: goal.title, target: goal.target, deadline: goal.deadline, ...progress, months: undefined } : null,
    credit: credit.length
      ? {
          total: credit.reduce((s, c) => s + c.amount, 0),
          count: credit.length,
          billedMonth: addMonths(monthOf(credit[credit.length - 1].spent_on), 1),
          byProvider: PAYLATER.map((p) => ({ key: p.key, name: p.name, total: credit.filter((c) => c.provider === p.key).reduce((s, c) => s + c.amount, 0) })).filter(
            (p) => p.total > 0,
          ),
        }
      : null,
    upcoming,
    fixedTotal: recurring.filter((r) => r.active === 1).reduce((s, r) => s + r.amount, 0),
    // Bỏ các tháng trống ở đầu (mới dùng bot vài tháng thì biểu đồ không bị trống một nửa).
    history: months.slice(Math.max(0, months.findIndex((m) => m.income || m.spent))).filter(() => months.some((m) => m.income || m.spent)),
  };
}

function readRecurring(body: Record<string, unknown>): { error: string } | { item: string; amount: number; day: number; category: string } {
  const item = typeof body.item === 'string' ? body.item.trim().slice(0, 80) : '';
  const amount = Math.round(Number(body.amount));
  const day = Math.round(Number(body.day));
  if (!item) return { error: 'Nhập tên khoản' };
  if (!(amount > 0) || amount > 10_000_000_000) return { error: 'Số tiền không hợp lệ' };
  if (!(day >= 1 && day <= 31)) return { error: 'Ngày trừ phải từ 1 đến 31' };
  return { item, amount, day, category: toCategory(body.category) };
}

/** Mục tiêu + tiến độ + kế hoạch; replan = nhờ AI lập lại kế hoạch. */
async function goalView(env: Env, chat: number, goal: Goal, today: string, replan = false) {
  let plan = parsePlan(goal);
  let planError: string | null = null;
  if (replan) {
    try {
      plan = await planGoal(env, chat, goal, today);
    } catch (error) {
      if (!(error instanceof PlanError)) throw error;
      planError = error.message;
    }
  }
  const { plan: _raw, ...rest } = goal;
  return { goal: rest, progress: await goalProgress(env, chat, goal, today), plan, planError };
}

// ---------- Tổng quan ----------

async function summary(env: Env, chat: number, q: URLSearchParams) {
  const to = isDay(q.get('to')) ? q.get('to')! : vnDate(Date.now());
  const from = isDay(q.get('from')) ? q.get('from')! : `${to.slice(0, 7)}-01`;
  const days = daysBetween(from, to) + 1;
  // Kỳ trước cùng độ dài để so sánh.
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const range = 'chat_id = ? AND spent_on BETWEEN ? AND ?';
  const [totals, prev, byCategory, byDay, topItems, trips] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN trip_id IS NOT NULL THEN amount END),0) AS travel
         FROM expenses WHERE ${range}`,
    ).bind(chat, from, to),
    env.DB.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE ${range}`).bind(chat, prevFrom, prevTo),
    env.DB.prepare(
      `SELECT category, SUM(amount) AS total, COUNT(*) AS count FROM expenses WHERE ${range} GROUP BY category ORDER BY total DESC`,
    ).bind(chat, from, to),
    env.DB.prepare(
      `SELECT spent_on AS day, SUM(amount) AS total,
              COALESCE(SUM(CASE WHEN trip_id IS NOT NULL THEN amount END),0) AS travel
         FROM expenses WHERE ${range} GROUP BY spent_on ORDER BY spent_on`,
    ).bind(chat, from, to),
    env.DB.prepare(
      `SELECT item, category, SUM(amount) AS total, COUNT(*) AS count FROM expenses WHERE ${range}
        GROUP BY lower(item) ORDER BY total DESC LIMIT 8`,
    ).bind(chat, from, to),
    env.DB.prepare(
      `SELECT t.id, t.city, t.started_on, t.ended_on, COALESCE(SUM(e.amount),0) AS total
         FROM trips t LEFT JOIN expenses e ON e.trip_id = t.id
        WHERE t.chat_id = ? AND t.ended_on >= ? AND t.started_on <= ?
        GROUP BY t.id ORDER BY t.started_on DESC`,
    ).bind(chat, from, to),
  ]);
  const t = totals.results[0] as { total: number; count: number; travel: number };
  return {
    from,
    to,
    days,
    total: t.total,
    count: t.count,
    travel: t.travel,
    perDay: Math.round(t.total / days),
    previous: { from: prevFrom, to: prevTo, total: (prev.results[0] as { total: number }).total },
    byCategory: byCategory.results,
    byDay: fillDays(from, to, byDay.results as { day: string; total: number; travel: number }[]),
    topItems: topItems.results,
    trips: trips.results,
  };
}

/** Thêm các ngày không chi tiêu (0) để biểu đồ không bị nhảy cóc. */
function fillDays(from: string, to: string, rows: { day: string; total: number; travel: number }[]) {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(map.get(d) ?? { day: d, total: 0, travel: 0 });
    if (out.length > 400) break;
  }
  return out;
}

// ---------- Chi tiêu ----------

async function listExpenses(env: Env, chat: number, q: URLSearchParams) {
  const where = ['e.chat_id = ?'];
  const params: unknown[] = [chat];
  const add = (clause: string, value?: unknown) => {
    where.push(clause);
    if (value !== undefined) params.push(value);
  };
  const from = q.get('from');
  const to = q.get('to');
  const trip = q.get('trip');
  if (isDay(from)) add('e.spent_on >= ?', from);
  if (isDay(to)) add('e.spent_on <= ?', to);
  if (q.get('category')) add('e.category = ?', q.get('category'));
  if (q.get('city')) add('e.city = ?', q.get('city'));
  if (trip === 'none') add('e.trip_id IS NULL');
  else if (trip === 'any') add('e.trip_id IS NOT NULL');
  else if (trip) add('e.trip_id = ?', Number(trip));
  if (q.get('q')) add('e.item LIKE ?', `%${q.get('q')}%`);
  const sorts: Record<string, string> = {
    day: 'e.spent_on DESC, e.id DESC',
    day_asc: 'e.spent_on ASC, e.id ASC',
    amount: 'e.amount DESC',
    amount_asc: 'e.amount ASC',
  };
  const order = sorts[q.get('sort') ?? 'day'] ?? sorts.day;
  const pageSize = Math.min(100, Math.max(10, Number(q.get('pageSize')) || 25));
  const page = Math.max(1, Number(q.get('page')) || 1);
  const sqlWhere = where.join(' AND ');
  const [rows, count] = await env.DB.batch([
    env.DB.prepare(
      `SELECT e.id, e.spent_on, e.item, e.category, e.amount, e.place, e.city, e.trip_id, t.city AS trip_city
         FROM expenses e LEFT JOIN trips t ON t.id = e.trip_id
        WHERE ${sqlWhere} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ).bind(...params, pageSize, (page - 1) * pageSize),
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(e.amount),0) AS total FROM expenses e WHERE ${sqlWhere}`).bind(...params),
  ]);
  const c = count.results[0] as { n: number; total: number };
  return { rows: rows.results, total: c.n, sum: c.total, page, pageSize };
}

function readExpense(body: Record<string, unknown>) {
  const amount = Math.round(Number(body.amount));
  const item = typeof body.item === 'string' ? body.item.trim().slice(0, 80) : '';
  if (!item) return { error: 'Nhập tên khoản chi' };
  if (!(amount > 0) || amount > 10_000_000_000) return { error: 'Số tiền không hợp lệ' };
  if (!isDay(body.spent_on)) return { error: 'Ngày không hợp lệ' };
  const text = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
  const trip = body.trip_id === null || body.trip_id === '' || body.trip_id === undefined ? null : Number(body.trip_id);
  return {
    value: {
      item,
      amount,
      category: toCategory(body.category),
      spent_on: body.spent_on,
      city: text(body.city, 60),
      place: text(body.place, 80),
      trip_id: Number.isInteger(trip) ? trip : null,
    },
  };
}

async function tripBelongs(env: Env, chat: number, tripId: number | null) {
  if (tripId === null) return true;
  return !!(await env.DB.prepare('SELECT 1 FROM trips WHERE id = ? AND chat_id = ?').bind(tripId, chat).first());
}

async function createExpense(env: Env, chat: number, body: Record<string, unknown>) {
  const { value, error } = readExpense(body);
  if (!value) return bad(error!);
  if (!(await tripBelongs(env, chat, value.trip_id))) return bad('Chuyến đi không tồn tại');
  const row = await env.DB.prepare(
    `INSERT INTO expenses (chat_id, amount, item, category, place, city, trip_id, spent_on, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(chat, value.amount, value.item, value.category, value.place, value.city, value.trip_id, value.spent_on, Date.now())
    .first<{ id: number }>();
  if (value.trip_id) await stretchTrip(env, value.trip_id);
  return json({ id: row?.id });
}

async function updateExpense(env: Env, chat: number, id: number, body: Record<string, unknown>) {
  const { value, error } = readExpense(body);
  if (!value) return bad(error!);
  if (!(await tripBelongs(env, chat, value.trip_id))) return bad('Chuyến đi không tồn tại');
  await env.DB.prepare(
    `UPDATE expenses SET amount = ?, item = ?, category = ?, place = ?, city = ?, trip_id = ?, spent_on = ?
      WHERE id = ? AND chat_id = ?`,
  )
    .bind(value.amount, value.item, value.category, value.place, value.city, value.trip_id, value.spent_on, id, chat)
    .run();
  if (value.trip_id) await stretchTrip(env, value.trip_id);
  await dropEmptyTrips(env, chat);
  return json({ ok: true });
}

/** Ngày đầu/cuối của chuyến luôn bao trùm các khoản chi trong chuyến. */
async function stretchTrip(env: Env, tripId: number) {
  await env.DB.prepare(
    `UPDATE trips SET
       started_on = MIN(started_on, COALESCE((SELECT MIN(spent_on) FROM expenses WHERE trip_id = ?), started_on)),
       ended_on   = MAX(ended_on,   COALESCE((SELECT MAX(spent_on) FROM expenses WHERE trip_id = ?), ended_on))
     WHERE id = ?`,
  )
    .bind(tripId, tripId, tripId)
    .run();
}

async function dropEmptyTrips(env: Env, chat: number) {
  await env.DB.prepare(
    `DELETE FROM trips WHERE chat_id = ? AND manual = 0
       AND id NOT IN (SELECT DISTINCT trip_id FROM expenses WHERE trip_id IS NOT NULL)
       AND id NOT IN (SELECT active_trip_id FROM settings WHERE active_trip_id IS NOT NULL)`,
  )
    .bind(chat)
    .run();
}

// ---------- Chuyến đi ----------

async function listTrips(env: Env, chat: number) {
  const rows = await env.DB.prepare(
    `SELECT t.id, t.city, t.started_on, t.ended_on, t.manual,
            COALESCE(SUM(e.amount),0) AS total, COUNT(e.id) AS count,
            (SELECT active_trip_id FROM settings WHERE chat_id = t.chat_id) = t.id AS active
       FROM trips t LEFT JOIN expenses e ON e.trip_id = t.id
      WHERE t.chat_id = ? GROUP BY t.id ORDER BY t.started_on DESC`,
  )
    .bind(chat)
    .all();
  return { rows: rows.results };
}

async function tripDetail(env: Env, chat: number, id: number) {
  const trip = await env.DB.prepare('SELECT * FROM trips WHERE id = ? AND chat_id = ?').bind(id, chat).first();
  if (!trip) return bad('Không tìm thấy chuyến đi', 404);
  const [byCategory, byDay, expenses] = await env.DB.batch([
    env.DB.prepare('SELECT category, SUM(amount) AS total, COUNT(*) AS count FROM expenses WHERE trip_id = ? GROUP BY category ORDER BY total DESC').bind(id),
    env.DB.prepare('SELECT spent_on AS day, SUM(amount) AS total FROM expenses WHERE trip_id = ? GROUP BY spent_on ORDER BY spent_on').bind(id),
    env.DB.prepare('SELECT id, spent_on, item, category, amount, place, city FROM expenses WHERE trip_id = ? ORDER BY spent_on, id').bind(id),
  ]);
  const total = (expenses.results as { amount: number }[]).reduce((s, e) => s + e.amount, 0);
  return json({ trip, total, byCategory: byCategory.results, byDay: byDay.results, expenses: expenses.results });
}

async function updateTrip(env: Env, chat: number, id: number, body: Record<string, unknown>) {
  const city = typeof body.city === 'string' ? body.city.trim().slice(0, 60) : '';
  if (!city) return bad('Nhập tên nơi đến');
  if (!isDay(body.started_on) || !isDay(body.ended_on) || body.started_on > body.ended_on) return bad('Ngày đi/về không hợp lệ');
  await env.DB.prepare('UPDATE trips SET city = ?, started_on = ?, ended_on = ? WHERE id = ? AND chat_id = ?')
    .bind(city, body.started_on, body.ended_on, id, chat)
    .run();
  await stretchTrip(env, id);
  return json({ ok: true });
}

/** Gộp chuyến :id vào chuyến body.into (VD đi Đà Lạt rồi ghé Nha Trang, muốn tính chung). */
async function mergeTrip(env: Env, chat: number, id: number, body: Record<string, unknown>) {
  const into = Number(body.into);
  if (!Number.isInteger(into) || into === id) return bad('Chọn chuyến để gộp vào');
  if (!(await tripBelongs(env, chat, id)) || !(await tripBelongs(env, chat, into))) return bad('Chuyến đi không tồn tại', 404);
  await env.DB.batch([
    env.DB.prepare('UPDATE expenses SET trip_id = ? WHERE trip_id = ? AND chat_id = ?').bind(into, id, chat),
    env.DB.prepare('UPDATE settings SET active_trip_id = ? WHERE chat_id = ? AND active_trip_id = ?').bind(into, chat, id),
    env.DB.prepare('DELETE FROM trips WHERE id = ? AND chat_id = ?').bind(id, chat),
  ]);
  await stretchTrip(env, into);
  return json({ ok: true });
}

// ---------- Xuất dữ liệu ----------

async function exportCsv(env: Env, chat: number) {
  const rows = await env.DB.prepare(
    `SELECT e.spent_on, e.item, e.category, e.amount, COALESCE(e.place,''), COALESCE(e.city,''), COALESCE(t.city,'')
       FROM expenses e LEFT JOIN trips t ON t.id = e.trip_id WHERE e.chat_id = ? ORDER BY e.spent_on, e.id`,
  )
    .bind(chat)
    .raw<unknown[]>();
  const cell = (v: unknown) => {
    const s = String(v ?? '');
    // Chặn công thức Excel (CSV injection) và bọc dấu nháy.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = [['Ngày', 'Khoản chi', 'Danh mục', 'Số tiền (VND)', 'Địa điểm', 'Thành phố', 'Chuyến đi'], ...rows];
  // BOM để Excel đọc đúng tiếng Việt.
  const csv = '﻿' + lines.map((r) => r.map(cell).join(',')).join('\r\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="chi-tieu-${vnDate(Date.now())}.csv"`,
    },
  });
}

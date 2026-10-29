import { handleAdmin } from './admin';
import { getPayday } from './prefs';
import { periodReport, remindDebts, remindIdle, remindPayday, sendMonthlyReports, setPref } from './reports';
import { isAllowedChat } from './accounts';
import { answerCallback, downloadFile, esc, removeButtons, send, typing, type Buttons } from './telegram';
import { isSalary, listPeriods, periodFor, receiveIncome, salaryState } from './period';
import { parseExpense, parseImage, type Env } from './ai';
import { askSpending } from './ask';
import {
  activeGoal,
  addIncome,
  categoryJarMap,
  createGoal,
  crossedThreshold,
  goalProgress,
  jarBudgets,
  jarLine,
  jarOfCategory,
  jarWarning,
  parsePlan,
  periodStatus,
  PlanError,
  planGoal,
  reviewMonth,
  setJarBudgets,
  type Goal,
  type GoalPlan,
  type GoalProgress,
} from './budget';
import {
  addMonths,
  daysBetween,
  emojiOf,
  formatDay,
  formatMonth,
  formatVnd,
  formatVndFull,
  JAR_KEYS,
  jarInfo,
  matchCategory,
  matchDay,
  matchPaylater,
  PAYLATER,
  paylaterInfo,
  type PaylaterKey,
  monthOf,
  monthPeriod,
  plain,
  parseAmount,
  parseDebt,
  parseGoal,
  sameCity,
  takeAmount,
  TRIP_GAP_DAYS,
  vnDate,
  type JarKey,
  type Parsed,
  type Period,
} from './core';
import { forecast, setBalance, type Forecast, type ForecastLine } from './balance';
import { addDebt, debtTotals, deleteDebt, getDebt, listDebts, openDebtsWith, payDebt, payPerson, type Debt } from './debts';
import { addCharges, billedMonth, payEarly, pendingCharges, settleCredit, type CreditCharge } from './credit';
import { addRecurring, chargeOne, dueDay, listRecurring, recurringTotal, runRecurring, type Recurring } from './recurring';

/**
 * Bot Telegram ghi chi tiêu (Cloudflare Worker + D1).
 * Telegram gọi POST /webhook kèm header X-Telegram-Bot-Api-Secret-Token; chỉ chat id trong ALLOWED_CHAT_IDS được dùng.
 */

type TgMessage = {
  message_id: number;
  chat: { id: number; type?: string };
  text?: string;
  caption?: string;
  date: number;
  photo?: { file_id: string; file_size?: number }[];
  document?: { file_id: string; mime_type?: string; file_size?: number };
  reply_to_message?: { message_id: number };
};

type TgCallback = { id: string; data?: string; message?: { message_id: number; chat: { id: number; type?: string } } };

/** Cron trong wrangler.toml: 00:05 và 21:00 giờ VN. */
const CRON_DAILY = '5 17 * * *';
const CRON_REMIND = '0 14 * * *';
type Trip = { id: number; city: string; started_on: string; ended_on: string; manual: number };

const HELP = `👋 Ghi chi tiêu bằng cách nhắn như bình thường:
• <code>phở 45k</code>
• <code>grab 62k, cafe 35k</code>
• <code>hôm qua đổ xăng 80k</code>

✈️ <b>Du lịch</b>: thêm nơi chốn, bot tự gom thành chuyến đi
• <code>bánh căn 60k ở Đà Lạt</code> hoặc <code>@Hội An: cao lầu 50k</code>
• <code>/dulich Đà Lạt</code> — mọi khoản sau đó tính vào chuyến (không cần ghi nơi), <code>/venha</code> để kết thúc
• <code>/nha TP.HCM</code> — thành phố nhà (chi ở đây không tính là du lịch)

📒 <b>Sổ nợ</b> (không tính là chi tiêu, có cộng/trừ số dư)
• <code>cho Nam mượn 500k hẹn 15/11</code> · <code>vay Hùng 2tr</code> · <code>Hùng cho mượn 2tr</code>
• <code>Nam trả 200k</code> · <code>trả Hùng 1tr</code> · <code>Nam trả hết</code> · <code>/no</code> xem sổ nợ

🫙 <b>Lương & hũ</b>
• <code>/luong 25tr</code> — ghi lương (chờ nhận); lương về thì bấm nút <b>+25tr</b>: cộng vào số dư và hôm đó là <b>đầu tháng mới</b>
• Thưởng cộng ngay: <code>/luong 3tr thưởng</code> · ngày lương để bot nhắc: <code>/ngayluong 27</code>
• <code>/chiahu 10tr 6tr 1tr 8tr</code> — chia hũ: bắt buộc, tiêu xài, nạp game, tiết kiệm (ghi % cũng được)
• <code>/hu</code> xem các hũ · <code>/danhgia</code> AI đánh giá tháng này

🎯 <b>Mục tiêu tiết kiệm</b>
• <code>/muctieu 50tr tới tháng 2 năm sau để mua laptop</code> (hoặc <code>sau 6 tháng</code>, thêm <code>đã có 10tr</code> nếu có sẵn)
• <code>/muctieu</code> xem tiến độ · <code>/muctieu lai</code> lập lại kế hoạch · <code>/muctieu xoa</code>

📸 <b>Gửi ảnh</b> hóa đơn hoặc ảnh chuyển khoản, bot tự đọc số tiền (ghi chú <code>tách</code> để tách từng món, <code>td</code> / <code>ts momo</code> nếu mua trả sau)
✏️ <b>Sửa nhanh</b>: reply tin bot báo đã ghi với <code>60k</code>, <code>ăn uống</code>, <code>hôm qua</code> hoặc <code>xóa</code>
🔔 21h chưa ghi gì thì bot nhắc (<code>/nhac tat</code> để tắt) · ngày 1 hằng tháng bot gửi tổng kết tháng trước (xem lúc nào cũng được: <code>/tongket</code>, <code>/tongket 10</code>)

💵 <b>Số dư</b>: <code>/sodu 15tr</code> nhập tiền đang có · <code>/sodu</code> xem còn bao nhiêu, cuối tháng & tháng sau còn bao nhiêu

💳 <b>Dư nợ trả sau</b> (thẻ tín dụng, MoMo / ZaloPay / SPayLater trả sau; trừ vào ngày 1 tháng sau)
• <code>td phở 45k</code> (thẻ tín dụng) · <code>ts momo grab 60k</code> · <code>ts zalopay …</code> · <code>ts spay …</code>
• <code>/the</code> xem dư nợ theo từng nguồn · <code>/the xoa</code> xóa lần ghi vừa rồi
• Trả sớm: <code>/the tra</code> (hết) · <code>/the tra momo</code> (chỉ MoMo) · <code>/the tra 2tr</code> (một phần, khoản cũ nhất trước)

🔁 <b>Chi cố định hàng tháng</b> (tự trừ vào ngày đã hẹn)
• <code>/codinh tiền nhà 5tr ngày 5</code> · <code>/codinh</code> xem danh sách
• <code>/codinh xoa 2</code> bỏ khoản số 2 · <code>/codinh tru 2</code> trừ luôn tháng này

📊 <code>/homnay</code> <code>/tuan</code> <code>/thang</code> · <code>/chuyendi</code> · <code>/xoa</code> (xóa khoản vừa ghi)
❓ <code>/hoi tháng này cà phê hết bao nhiêu?</code>`;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // Trang admin (file tĩnh trong admin/dist) do Cloudflare phục vụ; Worker chỉ nhận /webhook và /admin/api/*.
    if (url.pathname.startsWith('/admin/api/')) {
      return handleAdmin(request, env).catch((error) => {
        console.error('[admin] lỗi:', error);
        return Response.json({ error: 'Lỗi máy chủ' }, { status: 500 });
      });
    }
    if (request.method === 'GET' && url.pathname === '/health') return new Response('chi-tieu-bot ok');
    if (request.method !== 'POST' || url.pathname !== '/webhook') return new Response('not found', { status: 404 });
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 });
    }
    const update = (await request.json().catch(() => ({}))) as { message?: TgMessage; callback_query?: TgCallback };
    if (update.callback_query) {
      ctx.waitUntil(handleButton(env, update.callback_query).catch((error) => console.error('[button] lỗi:', error)));
      return new Response('ok');
    }
    const message = update.message;
    const isImage = !!message?.photo?.length || !!message?.document?.mime_type?.startsWith('image/');
    if (message?.text || isImage) {
      // Trả 200 cho Telegram ngay, xử lý tiếp ở nền (AI có thể mất vài giây).
      ctx.waitUntil(handle(env, message!, url.origin).catch((error) => console.error('[bot] lỗi:', error)));
    }
    return new Response('ok');
  },

  /**
   * 00:05: chuyển dư nợ trả sau, trừ khoản cố định, ngày 1 thì gửi tổng kết tháng trước.
   * 21:00: nhắc nếu hôm nay chưa ghi gì.
   */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const today = vnDate(Date.now());
        if (event.cron === CRON_REMIND) return remindIdle(env, today);
        for (const [chatId, rows] of await settleCredit(env, today)) await send(env, chatId, settledMessage(rows));
        for (const [chatId, rows] of await runRecurring(env, today)) await send(env, chatId, chargedMessage(rows));
        await sendMonthlyReports(env, today);
        await remindPayday(env, today);
        await remindDebts(env, today);
      })().catch((error) => console.error('[cron] lỗi:', error)),
    );
  },
} satisfies ExportedHandler<Env>;

function settledMessage(rows: CreditCharge[]) {
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  return [
    `💳 <b>Dư nợ trả sau đã chuyển thành chi tiêu tháng ${formatMonth(billedMonth(rows[0].spent_on))}</b>: ${formatVndFull(sum)} (${rows.length} khoản: ${byProvider(rows)})`,
    ...rows.slice(0, 15).map((r) => `${emojiOf(r.category)} ${esc(r.item)} (${paylaterInfo(r.provider).short} ${formatDay(r.spent_on)}): ${formatVnd(r.amount)}`),
    rows.length > 15 ? `… và ${rows.length - 15} khoản khác` : '',
    '',
    'Các khoản đã vào đúng hũ của tháng này. Xem: /hu',
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
}

function chargedMessage(rows: Recurring[]) {
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  return [
    `🔁 <b>Đã tự trừ khoản cố định</b> (${formatVndFull(sum)})`,
    ...rows.map((r) => `${emojiOf(r.category)} ${esc(r.item)}: <b>${formatVnd(r.amount)}</b>`),
    '',
    'Sai thì xóa trên trang admin hoặc /xoa. Xem các hũ: /hu',
  ].join('\n');
}

async function handle(env: Env, message: TgMessage, origin: string) {
  const chatId = message.chat.id;
  // Chỉ nhận chat riêng (nhóm có id âm, trùng vùng khóa dữ liệu của tài khoản chưa liên kết).
  if (message.chat.type && message.chat.type !== 'private') return;
  if (!(await isAllowedChat(env, chatId))) {
    // Người chưa có tài khoản: chỉ cách tạo tài khoản và liên kết, ngoài ra không làm gì.
    return send(
      env,
      chatId,
      [
        '👋 Chào bạn! Để dùng bot ghi chi tiêu:',
        `1. Tạo tài khoản tại ${env.APP_URL || origin}`,
        '2. Vào <b>Cài đặt → Liên kết Telegram</b>, nhập ID dưới đây',
        '3. Bot sẽ gửi mã 6 số vào đây, nhập mã đó trên web là xong',
        '',
        `ID Telegram của bạn: <code>${chatId}</code>`,
      ].join('\n'),
    );
  }
  if (!message.text) return recordPhoto(env, message);
  const text = message.text.trim();
  // Reply vào tin bot báo đã ghi (hoặc tin gốc của mình) = sửa nhanh khoản đó.
  if (message.reply_to_message && !text.startsWith('/') && (await editByReply(env, chatId, message.reply_to_message.message_id, text))) return;
  const [command, ...rest] = text.split(/\s+/);
  const arg = rest.join(' ').trim();
  const cmd = command.toLowerCase().replace(/@.*$/, '');
  const today = vnDate(Date.now());

  switch (cmd) {
    case '/start':
    case '/help':
      return send(env, chatId, HELP);
    case '/homnay':
      return send(env, chatId, await summary(env, chatId, today, today, 'Hôm nay'));
    case '/tuan':
      return send(env, chatId, await summary(env, chatId, vnDate(Date.now(), -6), today, '7 ngày qua'));
    case '/thang': {
      // Kỳ hiện tại: từ lần nhận lương gần nhất (hoặc đầu tháng lịch nếu chưa có).
      const p = await periodFor(env, chatId, today);
      return send(env, chatId, await summary(env, chatId, p.from, today, p.kind === 'cycle' ? `Kỳ từ ${formatDay(p.from)}` : `Tháng ${Number(today.slice(5, 7))}`));
    }
    case '/chuyendi':
      return send(env, chatId, await tripsReport(env, chatId));
    case '/nha':
      if (!arg) return send(env, chatId, `🏠 Thành phố nhà: <b>${esc(await homeCity(env, chatId))}</b>. Đổi: <code>/nha Đà Nẵng</code>`);
      await upsertSettings(env, chatId, { home_city: arg });
      return send(env, chatId, `🏠 Đã đặt thành phố nhà: <b>${esc(arg)}</b>. Chi tiêu ghi ở đây sẽ không tính là du lịch.`);
    case '/dulich':
      return startTrip(env, chatId, arg, today);
    case '/venha':
      return endTrip(env, chatId);
    case '/xoa':
      return undoLast(env, chatId);
    case '/hoi':
      return ask(env, chatId, arg);
    case '/luong':
      return income(env, chatId, arg, today);
    case '/hu': {
      const salary = await salaryState(env, chatId, today);
      const hint = salary.pending.length || salary.due ? '\n\n💰 <b>Lương chưa nhận</b>: lương về rồi thì bấm nút dưới để cộng vào số dư và bắt đầu tháng mới.' : '';
      return send(env, chatId, (await jarsReport(env, chatId, today)) + hint, salaryButtons({ pendingSalary: salary.pending, salaryDue: salary.due }));
    }
    case '/chiahu':
      return splitJars(env, chatId, arg, today);
    case '/danhgia':
      return review(env, chatId, today);
    case '/muctieu':
      return goal(env, chatId, arg, today);
    case '/codinh':
      return fixed(env, chatId, arg, today);
    case '/no':
      return debtCommand(env, chatId, arg, today);
    case '/the':
    case '/trasau':
      return credit(env, chatId, arg, message.message_id, cmd === '/trasau' ? 'other' : 'card');
    case '/sodu':
      return balance(env, chatId, arg, today);
    case '/tongket': {
      // "/tongket" = kỳ trước (hoặc tháng trước), "/tongket 10" hoặc "/tongket 10/2026" = tháng lịch đó.
      const m = arg.match(/^(\d{1,2})(?:\/(\d{4}))?$/);
      let period: Period;
      if (m) {
        period = monthPeriod(`${m[2] ?? (Number(m[1]) > Number(today.slice(5, 7)) ? Number(today.slice(0, 4)) - 1 : today.slice(0, 4))}-${m[1].padStart(2, '0')}`);
      } else {
        const periods = await listPeriods(env, chatId, today);
        period = periods[0].kind === 'cycle' ? (periods[1] ?? periods[0]) : monthPeriod(addMonths(monthOf(today), -1));
      }
      await typing(env, chatId);
      return send(env, chatId, (await periodReport(env, chatId, period, today)) ?? `${period.label} chưa có dữ liệu thu chi.`);
    }
    case '/ngayluong': {
      const n = Number(arg);
      if (arg && (!Number.isInteger(n) || n < 1 || n > 28)) return send(env, chatId, 'Ngày lương từ 1 đến 28. VD: <code>/ngayluong 27</code>');
      if (arg) await setPref(env, chatId, 'payday', String(n));
      const payday = await getPayday(env, chatId);
      return send(
        env,
        chatId,
        `💰 Ngày nhận lương: <b>ngày ${payday} hằng tháng</b> (lương tháng 10 về ngày ${payday}/10).${arg ? '' : ' Đổi: <code>/ngayluong 25</code>'}\nLương nhập trước ngày này sẽ được cộng vào số dư đúng ngày ${payday}.`,
      );
    }
    case '/nhac': {
      const off = /^(tat|tắt|off|0)$/i.test(arg);
      const on = /^(bat|bật|on|1)$/i.test(arg);
      if (off || on) await setPref(env, chatId, 'remind', on ? '1' : '0');
      return send(
        env,
        chatId,
        off ? '🔕 Đã tắt nhắc lúc 21h. Bật lại: /nhac bat' : on ? '🔔 Đã bật nhắc lúc 21h nếu hôm đó chưa ghi gì.' : 'Nhắc ghi chi tiêu lúc 21h: <code>/nhac bat</code> hoặc <code>/nhac tat</code>',
      );
    }
    default:
      if (cmd.startsWith('/')) return send(env, chatId, HELP);
      // "nhận lương 25tr", "thưởng 3tr" là thu nhập, không phải chi tiêu.
      if (/^(nhận\s+)?(lương|thưởng)\b/i.test(text) && takeAmount(text, 1000)) return income(env, chatId, text, today);
      // "số dư 15tr" / "đang có 15tr" = nhập số dư.
      {
        const bal = text.match(/^(?:số dư|so du|sodu|đang có|hiện có|tiền hiện có|còn bao nhiêu)\s*[:\-]?\s*(.*?)\??$/i);
        if (bal && (!bal[1] || takeAmount(bal[1], 0))) return balance(env, chatId, bal[1], today);
      }
      // Sổ nợ: "cho Nam mượn 500k", "vay Hùng 2tr", "Nam trả 200k", "trả Hùng 1tr" (trả chỉ khi có nợ với người đó).
      if (await debtMessage(env, chatId, text, message.message_id, today)) return;
      // Trả sớm: "trả thẻ 2tr" (chỉ thẻ tín dụng), "trả nợ momo", "trả dư nợ trả sau" (tất cả).
      {
        // (?=\s|$) thay cho \b vì \b của JS không coi chữ có dấu (ẻ, ợ) là chữ.
        const payCardOnly = text.match(/^(?:trả|thanh toán)\s+(?:nợ\s+)?thẻ(?:\s+tín dụng)?(?=\s|$)\s*(.*)$/i);
        if (payCardOnly) return payCard(env, chatId, `thẻ ${payCardOnly[1]}`.trim());
        const payAll = text.match(/^(?:trả|thanh toán)\s+(?:dư\s+)?nợ(?:\s+trả\s+sau)?(?=\s|$)\s*(.*)$/i);
        if (payAll) return payCard(env, chatId, payAll[1].trim());
      }
      // Mua trả sau: "td phở 45k" (thẻ tín dụng), "ts momo phở 45k" / "trả sau zalopay: grab 60k".
      {
        const card = text.match(/^(?:td|tín dụng|thẻ tín dụng)\s*[:\-]?\s+(.+)$/is);
        if (card) return credit(env, chatId, card[1], message.message_id, 'card');
        const later = text.match(/^(?:ts|trả sau)\s*[:\-]?\s+(.+)$/is);
        if (later) return credit(env, chatId, later[1], message.message_id, 'other');
      }
      return record(env, chatId, text, message.message_id);
  }
}

// ---------- Ghi chi tiêu ----------

async function record(env: Env, chatId: number, text: string, messageId: number) {
  const parsed = await parseExpense(env, text);
  if (parsed.items.length === 0) {
    await send(env, chatId, `🤔 Mình không thấy khoản chi nào. Thử: <code>phở 45k</code> hoặc gõ /help`);
    return;
  }
  return recordParsed(env, chatId, parsed, messageId);
}

/** Lưu các khoản đã đọc (từ tin nhắn hoặc ảnh) và báo lại; nhớ tin báo để reply sửa được. */
async function recordParsed(env: Env, chatId: number, parsed: Parsed & { source: string }, messageId: number, header?: string) {
  const day = vnDate(Date.now(), parsed.dayOffset);
  const trip = await tripFor(env, chatId, parsed, day);
  const now = Date.now();
  await env.DB.batch(
    parsed.items.map((i) =>
      env.DB.prepare(
        `INSERT INTO expenses (chat_id, amount, item, category, place, city, trip_id, spent_on, created_at, message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(chatId, i.amount, i.item, i.category, parsed.place, parsed.city, trip?.id ?? null, day, now, messageId),
    ),
  );

  const lines = parsed.items.map((i) => `${emojiOf(i.category)} ${esc(i.item)}: <b>${formatVnd(i.amount)}</b> <i>(${i.category})</i>`);
  if (header) lines.unshift(header);
  if (day !== vnDate(Date.now())) lines.push(`<i>Ngày ${formatDay(day)}</i>`);
  const dayTotal = await total(env, 'chat_id = ? AND spent_on = ?', [chatId, day]);
  lines.push('', `📅 ${day === vnDate(Date.now()) ? 'Hôm nay' : formatDay(day)}: ${formatVndFull(dayTotal)}`);
  if (trip) {
    const tripTotal = await total(env, 'trip_id = ?', [trip.id]);
    const days = daysBetween(trip.started_on, trip.ended_on) + 1;
    lines.push(`✈️ Chuyến <b>${esc(trip.city)}</b> (${days} ngày): <b>${formatVndFull(tripTotal)}</b>`);
  }
  lines.push(...(await jarNotes(env, chatId, parsed, day)));
  if (parsed.source === 'fallback') lines.push('', '<i>AI đang bận nên mình đọc tạm, danh mục để "Khác". Reply tin này để sửa.</i>');
  if (header) lines.push('', '<i>Sai thì reply tin này: <code>60k</code>, <code>ăn uống</code>, <code>hôm qua</code> hoặc <code>xóa</code></i>');
  await remember(env, chatId, await send(env, chatId, lines.join('\n')), 'expense', messageId);
}

async function remember(env: Env, chatId: number, botMessageId: number | null, kind: 'expense' | 'credit', ref: number) {
  if (!botMessageId) return;
  await env.DB.prepare('INSERT OR REPLACE INTO bot_messages (chat_id, bot_message_id, kind, ref, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(chatId, botMessageId, kind, ref, Date.now())
    .run();
}

// ---------- Ảnh hóa đơn / chuyển khoản ----------

async function recordPhoto(env: Env, message: TgMessage) {
  const chatId = message.chat.id;
  const caption = (message.caption ?? '').trim();
  // Ảnh lớn nhất nhưng không quá ~2,5MB (đủ nét để đọc chữ, gửi Gemini nhanh).
  const sizes = message.photo ?? [];
  const photo = [...sizes].reverse().find((p) => (p.file_size ?? 0) <= 2_500_000) ?? sizes[sizes.length - 1];
  const fileId = photo?.file_id ?? message.document?.file_id;
  if (!fileId) return;
  if ((message.document?.file_size ?? 0) > 10_000_000) {
    await send(env, chatId, 'Ảnh lớn quá (trên 10MB). Gửi dạng ảnh thường (không phải file) giúp mình nhé.');
    return;
  }
  await typing(env, chatId);
  // Ghi chú "td …" = thẻ tín dụng, "ts momo …" = trả sau qua MoMo.
  const card = caption.match(/^(td|tín dụng|thẻ tín dụng|ts|trả sau)(?=[\s:\-]|$)\s*[:\-]?\s*(.*)$/is);
  const later = card ? splitProvider(card[2], /^(ts|trả sau)$/i.test(card[1]) ? 'other' : 'card') : null;
  const note = later ? later.rest : caption;
  let parsed;
  try {
    const file = await downloadFile(env, fileId);
    const mime = message.document?.mime_type ?? 'image/jpeg';
    parsed = await parseImage(env, { data: file.data, mime }, note, vnDate(Date.now()));
  } catch (error) {
    console.error('[photo] lỗi:', error);
    await send(env, chatId, '😵 Mình chưa đọc được ảnh lúc này (AI lỗi). Nhắn tay giúp mình nhé, VD <code>highlands 65k</code>.');
    return;
  }
  if (parsed.kind === 'other' || parsed.items.length === 0) {
    await send(env, chatId, '🤔 Ảnh này không giống hóa đơn hay chuyển khoản. Nếu đúng là khoản chi thì nhắn tay giúp mình nhé.');
    return;
  }
  const header = parsed.kind === 'transfer' ? '🏦 <b>Đọc từ ảnh chuyển khoản:</b>' : '🧾 <b>Đọc từ hóa đơn:</b>';
  const result = { ...parsed, source: 'gemini' };
  if (later) return creditParsed(env, chatId, result, message.message_id, later.provider, header);
  return recordParsed(env, chatId, result, message.message_id, header);
}

// ---------- Sửa nhanh bằng reply ----------

type EditRow = { id: number; item: string; amount: number; category: string; spent_on: string };

/**
 * Reply vào tin bot báo đã ghi: "60k" sửa số tiền, "ăn uống" đổi danh mục, "hôm qua" / "20/10" đổi ngày, "xóa" xóa.
 * Tin có nhiều khoản thì ghi kèm tên: "grab 60k". Trả về false nếu tin được reply không gắn với khoản nào (xử lý như tin thường).
 */
async function editByReply(env: Env, chatId: number, replyTo: number, text: string): Promise<boolean> {
  const map = await env.DB.prepare('SELECT kind, ref FROM bot_messages WHERE chat_id = ? AND bot_message_id = ?')
    .bind(chatId, replyTo)
    .first<{ kind: 'expense' | 'credit'; ref: number }>();
  const ref = map?.ref ?? replyTo; // reply thẳng vào tin gốc của mình cũng được
  const load = (kind: 'expense' | 'credit') =>
    env.DB.prepare(
      kind === 'credit'
        ? 'SELECT id, item, amount, category, spent_on FROM credit_charges WHERE chat_id = ? AND message_id = ? AND settled = 0 ORDER BY id'
        : 'SELECT id, item, amount, category, spent_on FROM expenses WHERE chat_id = ? AND message_id = ? ORDER BY id',
    )
      .bind(chatId, ref)
      .all<EditRow>()
      .then((r) => r.results);
  let kind = map?.kind ?? 'expense';
  let rows = await load(kind);
  if (!map && rows.length === 0) {
    kind = 'credit';
    rows = await load(kind);
    if (rows.length === 0) return false;
  }
  if (rows.length === 0) {
    await send(env, chatId, kind === 'credit' ? 'Khoản trả sau này đã bị xóa hoặc đã chuyển thành chi tiêu (sửa trên trang admin).' : 'Khoản này đã bị xóa rồi.');
    return true;
  }
  const table = kind === 'credit' ? 'credit_charges' : 'expenses';

  if (/^(xóa|xoá|xoa|hủy|huỷ|huy|delete)$/i.test(text.trim())) {
    await env.DB.batch(rows.map((r) => env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(r.id)));
    if (kind === 'expense') await dropEmptyAutoTrips(env, chatId);
    await send(env, chatId, `🗑️ Đã xóa: ${rows.map((r) => `${esc(r.item)} ${formatVnd(r.amount)}`).join(', ')}`);
    return true;
  }

  // Nhiều khoản: tìm khoản được nhắc tên ("grab 60k"), rồi bỏ tên khỏi câu để đọc phần sửa.
  let rest = text;
  let targets = rows;
  if (rows.length > 1) {
    // Phần tên = các từ không phải số tiền / ngày / danh mục; khớp khi tên khoản chứa phần đó hoặc ngược lại ("banh mi" ~ "Bánh mì thịt").
    const words = text.split(/\s+/).filter((w) => !parseAmount(w) && !/^\d{1,2}\/\d{1,2}$/.test(w));
    for (let n = words.length; n > 0 && targets === rows; n--) {
      const name = plain(words.slice(0, n).join(' '));
      if (!name) continue;
      const named = rows.filter((r) => plain(r.item).includes(name) || name.includes(plain(r.item)));
      if (named.length === 1) {
        targets = named;
        rest = [...words.slice(n), ...text.split(/\s+/).filter((w) => !words.includes(w))].join(' ');
      }
    }
  }
  const today = vnDate(Date.now());
  const amount = takeAmount(rest, 1000)?.amount ?? null;
  const category = matchCategory(amount ? takeAmount(rest, 1000)!.rest : rest);
  const day = matchDay(rest, today);
  if (!amount && !category && !day) {
    await send(env, chatId, 'Reply để sửa: <code>60k</code> (số tiền), <code>ăn uống</code> (danh mục), <code>hôm qua</code> / <code>20/10</code> (ngày) hoặc <code>xóa</code>.');
    return true;
  }
  if (amount && targets.length > 1) {
    await send(env, chatId, `Tin này có ${targets.length} khoản, ghi kèm tên để sửa số tiền, VD <code>${esc(targets[0].item)} ${formatVnd(amount)}</code>.`);
    return true;
  }
  const changes: string[] = [];
  for (const r of targets) {
    const next = { amount: amount ?? r.amount, category: category ?? r.category, spent_on: day ?? r.spent_on };
    await env.DB.prepare(`UPDATE ${table} SET amount = ?, category = ?, spent_on = ? WHERE id = ?`).bind(next.amount, next.category, next.spent_on, r.id).run();
    const diff = [
      amount && amount !== r.amount ? `${formatVnd(r.amount)} → <b>${formatVnd(amount)}</b>` : '',
      category && category !== r.category ? `${r.category} → <b>${category}</b>` : '',
      day && day !== r.spent_on ? `ngày ${formatDay(r.spent_on)} → <b>${formatDay(day)}</b>` : '',
    ].filter(Boolean);
    changes.push(`${emojiOf(next.category)} ${esc(r.item)}: ${diff.join(', ') || 'không đổi'}`);
  }
  await send(env, chatId, `✏️ Đã sửa\n${changes.join('\n')}`);
  return true;
}

/** Chuyến tự động không còn khoản nào thì xóa. */
async function dropEmptyAutoTrips(env: Env, chatId: number) {
  await env.DB.prepare(
    'DELETE FROM trips WHERE chat_id = ? AND manual = 0 AND id NOT IN (SELECT DISTINCT trip_id FROM expenses WHERE trip_id IS NOT NULL)',
  )
    .bind(chatId)
    .run();
}

/** Tình trạng các hũ vừa có khoản chi; hũ vừa chạm 80% hoặc vượt mức thì AI nhắc thêm. */
async function jarNotes(env: Env, chatId: number, parsed: Parsed, day: string) {
  const budgets = await jarBudgets(env, chatId);
  if (!Object.values(budgets).some((v) => v > 0)) return [];
  const map = await categoryJarMap(env, chatId);
  const added = new Map<JarKey, number>();
  for (const i of parsed.items) {
    const jar = jarOfCategory(map, i.category);
    added.set(jar, (added.get(jar) ?? 0) + i.amount);
  }
  const status = await periodStatus(env, chatId, await periodFor(env, chatId, vnDate(Date.now()), day), vnDate(Date.now()));
  const lines = [''];
  for (const j of status.jars) {
    if (!added.has(j.key)) continue;
    lines.push(jarLine(j));
    const level = crossedThreshold(j, added.get(j.key)!);
    if (level) {
      const just = parsed.items.map((i) => `${i.item} ${formatVnd(i.amount)}`).join(', ');
      lines.push(`💬 <i>${esc(await jarWarning(env, status, j, level, just))}</i>`);
    }
  }
  return lines;
}

/**
 * Chuyến đi cho khoản chi này:
 * - đang bật /dulich: luôn là chuyến đó (kéo dài ngày kết thúc nếu cần);
 * - có nơi chốn khác thành phố nhà: chuyến cùng nơi gần nhất (cách không quá TRIP_GAP_DAYS ngày), không có thì tạo mới;
 * - còn lại: không thuộc chuyến nào.
 */
async function tripFor(env: Env, chatId: number, parsed: Parsed, day: string): Promise<Trip | null> {
  const settings = await getSettings(env, chatId);
  if (settings?.active_trip_id) {
    const active = await env.DB.prepare('SELECT * FROM trips WHERE id = ?').bind(settings.active_trip_id).first<Trip>();
    if (active) return extendTrip(env, active, day);
  }
  if (!parsed.city || sameCity(parsed.city, await homeCity(env, chatId))) return null;

  const recent = await env.DB.prepare('SELECT * FROM trips WHERE chat_id = ? ORDER BY ended_on DESC LIMIT 20')
    .bind(chatId)
    .all<Trip>();
  const match = recent.results.find(
    (t) => sameCity(t.city, parsed.city) && daysBetween(t.ended_on, day) <= TRIP_GAP_DAYS && daysBetween(day, t.started_on) <= TRIP_GAP_DAYS,
  );
  if (match) return extendTrip(env, match, day);
  const created = await env.DB.prepare('INSERT INTO trips (chat_id, city, started_on, ended_on) VALUES (?, ?, ?, ?) RETURNING *')
    .bind(chatId, parsed.city, day, day)
    .first<Trip>();
  return created;
}

async function extendTrip(env: Env, trip: Trip, day: string): Promise<Trip> {
  const started_on = day < trip.started_on ? day : trip.started_on;
  const ended_on = day > trip.ended_on ? day : trip.ended_on;
  if (started_on !== trip.started_on || ended_on !== trip.ended_on) {
    await env.DB.prepare('UPDATE trips SET started_on = ?, ended_on = ? WHERE id = ?').bind(started_on, ended_on, trip.id).run();
  }
  return { ...trip, started_on, ended_on };
}

async function startTrip(env: Env, chatId: number, city: string, today: string) {
  if (!city) return send(env, chatId, 'Đi đâu vậy? Ví dụ: <code>/dulich Đà Lạt</code>');
  const trip = await env.DB.prepare('INSERT INTO trips (chat_id, city, started_on, ended_on, manual) VALUES (?, ?, ?, ?, 1) RETURNING *')
    .bind(chatId, city, today, today)
    .first<Trip>();
  await upsertSettings(env, chatId, { active_trip_id: trip!.id });
  return send(env, chatId, `✈️ Bắt đầu chuyến <b>${esc(city)}</b>. Mọi khoản chi từ giờ sẽ tính vào chuyến này. Về thì gõ /venha nhé!`);
}

async function endTrip(env: Env, chatId: number) {
  const settings = await getSettings(env, chatId);
  if (!settings?.active_trip_id) return send(env, chatId, 'Bạn không có chuyến đi nào đang bật. Xem các chuyến: /chuyendi');
  await upsertSettings(env, chatId, { active_trip_id: null });
  return send(env, chatId, `🏠 Chào mừng về nhà!\n\n${await tripDetail(env, settings.active_trip_id)}`);
}

async function undoLast(env: Env, chatId: number) {
  const last = await env.DB.prepare('SELECT id, message_id FROM expenses WHERE chat_id = ? ORDER BY id DESC LIMIT 1')
    .bind(chatId)
    .first<{ id: number; message_id: number | null }>();
  if (!last) return send(env, chatId, 'Chưa có khoản nào để xóa.');
  // Khoản tự trừ / thêm trên admin không có message_id: xóa theo id.
  const removed = await (last.message_id === null
    ? env.DB.prepare('DELETE FROM expenses WHERE id = ? RETURNING item, amount').bind(last.id)
    : env.DB.prepare('DELETE FROM expenses WHERE chat_id = ? AND message_id = ? RETURNING item, amount').bind(chatId, last.message_id)
  ).all<{ item: string; amount: number }>();
  // Chuyến tự động không còn khoản nào thì xóa luôn.
  await env.DB.prepare(
    'DELETE FROM trips WHERE chat_id = ? AND manual = 0 AND id NOT IN (SELECT DISTINCT trip_id FROM expenses WHERE trip_id IS NOT NULL)',
  )
    .bind(chatId)
    .run();
  const list = removed.results.map((r) => `${esc(r.item)} ${formatVnd(r.amount)}`).join(', ');
  return send(env, chatId, `🗑️ Đã xóa: ${list}`);
}

// ---------- Báo cáo ----------

async function total(env: Env, where: string, params: unknown[]) {
  const row = await env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE ${where}`)
    .bind(...params)
    .first<{ s: number }>();
  return row?.s ?? 0;
}

async function byCategory(env: Env, where: string, params: unknown[]) {
  const rows = await env.DB.prepare(
    `SELECT category, SUM(amount) AS s, COUNT(*) AS n FROM expenses WHERE ${where} GROUP BY category ORDER BY s DESC`,
  )
    .bind(...params)
    .all<{ category: string; s: number; n: number }>();
  return rows.results;
}

const bar = (part: number, whole: number) => '▇'.repeat(Math.max(1, Math.round((part / Math.max(whole, 1)) * 10)));

async function summary(env: Env, chatId: number, from: string, to: string, title: string) {
  const where = 'chat_id = ? AND spent_on BETWEEN ? AND ?';
  const params = [chatId, from, to];
  const sum = await total(env, where, params);
  if (sum === 0) return `📊 <b>${title}</b>: chưa có khoản chi nào.`;
  const cats = await byCategory(env, where, params);
  const travel = await total(env, `${where} AND trip_id IS NOT NULL`, params);
  const days = daysBetween(from, to) + 1;
  return [
    `📊 <b>${title}</b>: <b>${formatVndFull(sum)}</b>${days > 1 ? ` · TB ${formatVnd(sum / days)}/ngày` : ''}`,
    '',
    ...cats.map((c) => `${emojiOf(c.category)} ${c.category}: <b>${formatVnd(c.s)}</b> ${bar(c.s, sum)}`),
    travel > 0 ? `\n✈️ Trong đó du lịch: ${formatVnd(travel)} (${Math.round((travel / sum) * 100)}%)` : '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

async function tripDetail(env: Env, tripId: number) {
  const trip = await env.DB.prepare('SELECT * FROM trips WHERE id = ?').bind(tripId).first<Trip>();
  if (!trip) return 'Không tìm thấy chuyến đi.';
  const sum = await total(env, 'trip_id = ?', [trip.id]);
  const days = daysBetween(trip.started_on, trip.ended_on) + 1;
  const cats = await byCategory(env, 'trip_id = ?', [trip.id]);
  return [
    `✈️ <b>${esc(trip.city)}</b> · ${formatDay(trip.started_on)}${days > 1 ? `–${formatDay(trip.ended_on)}` : ''} (${days} ngày)`,
    `Tổng: <b>${formatVndFull(sum)}</b> · TB ${formatVnd(sum / days)}/ngày`,
    ...cats.map((c) => `  ${emojiOf(c.category)} ${c.category}: ${formatVnd(c.s)}`),
  ].join('\n');
}

async function tripsReport(env: Env, chatId: number) {
  const trips = await env.DB.prepare('SELECT * FROM trips WHERE chat_id = ? ORDER BY started_on DESC LIMIT 5')
    .bind(chatId)
    .all<Trip>();
  if (trips.results.length === 0) {
    return '✈️ Chưa có chuyến đi nào. Ghi chi tiêu kèm nơi chốn (<code>phở 45k ở Đà Lạt</code>) hoặc gõ <code>/dulich Đà Lạt</code>.';
  }
  const parts = await Promise.all(trips.results.map((t) => tripDetail(env, t.id)));
  return parts.join('\n\n');
}

async function ask(env: Env, chatId: number, question: string) {
  if (!question) return send(env, chatId, 'Hỏi gì nè? VD: <code>/hoi tháng này ăn uống hết bao nhiêu?</code>');
  await typing(env, chatId);
  const answer = await askSpending(env, chatId, question);
  return send(env, chatId, answer === null ? 'Chưa có dữ liệu chi tiêu để trả lời.' : esc(answer));
}

// ---------- Lương & hũ ----------

async function income(env: Env, chatId: number, text: string, today: string) {
  const found = takeAmount(text, 1000);
  if (!found) return send(env, chatId, 'Ví dụ: <code>/luong 25tr</code> hoặc <code>/luong 3tr thưởng dự án</code>');
  const month = monthOf(today);
  const note = found.rest.trim().replace(/^(nhận\s+)?/i, '').slice(0, 60) || 'Lương';
  // Lương: ghi "chờ nhận", bấm nút khi tiền về mới cộng vào số dư và bắt đầu tháng mới. Thưởng / khoản khác: cộng ngay.
  const salary = isSalary(note);
  const row = await addIncome(env, chatId, month, found.amount, note, !salary);
  if (salary) {
    return send(
      env,
      chatId,
      [
        `💰 Đã ghi <b>${esc(note)} ${formatVndFull(found.amount)}</b>, đang <b>chờ nhận</b>.`,
        'Khi lương về tài khoản, bấm nút dưới: lương được cộng vào số dư và <b>hôm đó là đầu tháng mới</b> (các hũ tính lại từ đầu).',
      ].join('\n'),
      [[{ text: `✅ Đã nhận +${formatVnd(found.amount)}`, data: `inc:${row!.id}` }]],
    );
  }
  const status = await periodStatus(env, chatId, await periodFor(env, chatId, today), today);
  return send(
    env,
    chatId,
    [
      `💰 Đã cộng <b>+${formatVndFull(found.amount)}</b> (${esc(note)}) vào thu nhập và số dư.`,
      `Thu nhập · ${status.period.label}: <b>${formatVndFull(status.income)}</b> · đã chi ${formatVnd(status.spent)}`,
    ].join('\n'),
  );
}

/** Nút "+lương" cho các khoản lương đang chờ (hoặc lương dự kiến khi tới ngày mà chưa ghi). */
function salaryButtons(f: Pick<Forecast, 'pendingSalary' | 'salaryDue'>): Buttons {
  if (f.pendingSalary.length) return f.pendingSalary.map((p) => [{ text: `✅ Đã nhận +${formatVnd(p.amount)} (${p.note || 'Lương'})`, data: `inc:${p.id}` }]);
  if (f.salaryDue) return [[{ text: `✅ Đã nhận lương +${formatVnd(f.salaryDue.amount)}`, data: `sal:${f.salaryDue.amount}` }]];
  return [];
}

/** Bấm "+lương": cộng vào số dư, mở tháng mới, gửi tổng kết kỳ vừa xong. */
async function handleButton(env: Env, q: TgCallback) {
  const chatId = q.message?.chat.id;
  if (!chatId || (q.message?.chat.type && q.message.chat.type !== 'private') || !(await isAllowedChat(env, chatId))) {
    return answerCallback(env, q.id);
  }
  const today = vnDate(Date.now());
  const [kind, value] = (q.data ?? '').split(':');
  if (kind === 'debt') return debtButton(env, chatId, q, Number(value), today);
  const target = kind === 'inc' ? { incomeId: Number(value) } : kind === 'sal' ? { amount: Number(value) } : null;
  if (!target || !Object.values(target).every((n) => Number.isInteger(n) && n > 0)) return answerCallback(env, q.id);
  const result = await receiveIncome(env, chatId, today, target);
  await removeButtons(env, chatId, q.message!.message_id);
  if (!result) {
    await answerCallback(env, q.id, 'Khoản này đã được nhận rồi');
    return;
  }
  await answerCallback(env, q.id, `Đã cộng +${formatVnd(result.amount)}`);
  const lines = [`💰 Đã cộng <b>+${formatVndFull(result.amount)}</b> (${esc(result.note)}) vào số dư.`];
  if (result.started) {
    lines.push(`📅 <b>Bắt đầu tháng mới từ hôm nay (${formatDay(today)})</b>: các hũ tính lại từ đầu, kỳ này dự kiến tới ${formatDay(result.started.to)}.`);
  }
  lines.push('Xem các hũ: /hu · số dư: /sodu');
  await send(env, chatId, lines.join('\n'));
  if (result.previous) {
    const report = await periodReport(env, chatId, result.previous, today);
    if (report) await send(env, chatId, report);
  }
}

function allocationNote(income: number, allocated: number) {
  if (!allocated) return 'Chưa chia hũ. Chia lương: <code>/chiahu 10tr 6tr 1tr 8tr</code> (bắt buộc, tiêu xài, nạp game, tiết kiệm)';
  if (!income) return `Đã chia hũ ${formatVnd(allocated)} nhưng tháng này chưa nhập lương (/luong 25tr).`;
  if (allocated > income) return `⚠️ Các hũ cộng lại ${formatVnd(allocated)}, vượt lương ${formatVnd(allocated - income)}. Chia lại: /chiahu`;
  if (allocated < income) return `Các hũ cộng lại ${formatVnd(allocated)}, còn ${formatVnd(income - allocated)} chưa chia vào hũ nào.`;
  return '✅ Đã chia hết lương vào các hũ.';
}

async function jarsReport(env: Env, chatId: number, today: string) {
  const s = await periodStatus(env, chatId, await periodFor(env, chatId, today), today);
  return [
    `🫙 <b>Các hũ · ${s.period.label}</b> (đã qua ${s.daysPassed}/${s.daysInMonth} ngày)`,
    `💰 Thu nhập: ${s.income ? formatVnd(s.income) : 'chưa nhập (/luong 25tr)'} · Đã chi: ${formatVnd(s.spent)}${s.saved !== null ? ` · Còn dư: <b>${formatVnd(s.saved)}</b>` : ''}`,
    '',
    ...s.jars.map(jarLine),
    '',
    allocationNote(s.income, s.jars.reduce((sum, j) => sum + j.budget, 0)),
    `🔁 Chi cố định: ${formatVnd(await recurringTotal(env, chatId))}/tháng (/codinh)`,
    ...[await creditLine(env, chatId)].filter(Boolean),
    'AI nhận xét: /danhgia',
  ].join('\n');
}

/** /chiahu 10tr 6tr 1tr 8tr hoặc /chiahu 40% 25% 5% 30% (theo lương tháng này). */
async function splitJars(env: Env, chatId: number, arg: string, today: string) {
  const parts = arg.split(/\s+/).filter(Boolean);
  const usage = `Chia theo thứ tự: ${JAR_KEYS.map((k) => jarInfo(k).name.toLowerCase()).join(', ')}.\nVD: <code>/chiahu 10tr 6tr 1tr 8tr</code> hoặc <code>/chiahu 40% 25% 5% 30%</code>`;
  if (parts.length !== JAR_KEYS.length) return send(env, chatId, `${await jarsReport(env, chatId, today)}\n\n${usage}`);
  const status = await periodStatus(env, chatId, await periodFor(env, chatId, today), today);
  const amounts: Partial<Record<JarKey, number>> = {};
  for (const [i, part] of parts.entries()) {
    const percent = part.match(/^(\d+(?:[.,]\d+)?)%$/);
    if (percent && !status.income) return send(env, chatId, 'Chia theo % cần lương tháng này trước: <code>/luong 25tr</code>');
    const value = percent ? Math.round((Number(percent[1].replace(',', '.')) / 100) * status.income) : (parseAmount(part) ?? (part === '0' ? 0 : null));
    if (value === null) return send(env, chatId, `Không đọc được "${esc(part)}".\n${usage}`);
    amounts[JAR_KEYS[i]] = value;
  }
  await setJarBudgets(env, chatId, amounts);
  return send(env, chatId, `✅ Đã chia hũ.\n\n${await jarsReport(env, chatId, today)}`);
}

async function review(env: Env, chatId: number, today: string) {
  const s = await periodStatus(env, chatId, await periodFor(env, chatId, today), today);
  const text = await reviewMonth(env, s);
  return send(env, chatId, `🧐 <b>Đánh giá · ${s.period.label}</b>\n\n${esc(text)}`);
}

// ---------- Mục tiêu tiết kiệm ----------

async function goal(env: Env, chatId: number, arg: string, today: string) {
  const current = await activeGoal(env, chatId);
  const action = arg.toLowerCase();
  if (!arg) {
    if (!current) return send(env, chatId, 'Chưa có mục tiêu. VD: <code>/muctieu 50tr tới tháng 2 năm sau để mua laptop</code>');
    return send(env, chatId, goalMessage(current, await goalProgress(env, chatId, current, today), parsePlan(current)));
  }
  if (['xoa', 'xóa', 'huy', 'hủy'].includes(action)) {
    if (!current) return send(env, chatId, 'Không có mục tiêu nào đang chạy.');
    await env.DB.prepare('UPDATE goals SET active = 0 WHERE id = ?').bind(current.id).run();
    return send(env, chatId, `🗑️ Đã bỏ mục tiêu "${esc(current.title)}".`);
  }
  if (['lai', 'lại', 'kehoach', 'kế hoạch'].includes(action)) {
    if (!current) return send(env, chatId, 'Chưa có mục tiêu để lập kế hoạch.');
    return planAndSend(env, chatId, current, today);
  }

  // "đã có 10tr" = tiền có sẵn, tách ra trước khi đọc mục tiêu.
  let text = arg;
  let savedBefore = 0;
  const have = text.match(/(?:đã có|có sẵn|đang có)\s+(\S+)(\s+(?:triệu|tr|củ|k|nghìn))?/i);
  if (have) {
    savedBefore = parseAmount(have[1] + (have[2] ?? '')) ?? 0;
    text = text.replace(have[0], ' ');
  }
  const parsed = parseGoal(text, today);
  if (!parsed) {
    return send(env, chatId, 'Mình chưa hiểu. VD: <code>/muctieu 50tr tới tháng 2 năm sau để mua laptop</code> hoặc <code>/muctieu 30tr sau 6 tháng</code>');
  }
  const created = await createGoal(env, chatId, { ...parsed, saved_before: savedBefore }, today);
  await send(env, chatId, `🎯 Đã đặt mục tiêu <b>${esc(created!.title)}</b>: ${formatVndFull(created!.target)} trước hết tháng ${formatMonth(created!.deadline)}. Đang lập kế hoạch…`);
  return planAndSend(env, chatId, created!, today);
}

async function planAndSend(env: Env, chatId: number, g: Goal, today: string) {
  try {
    const plan = await planGoal(env, chatId, g, today);
    return send(env, chatId, goalMessage(g, await goalProgress(env, chatId, g, today), plan));
  } catch (error) {
    if (error instanceof PlanError) return send(env, chatId, `🎯 ${esc(error.message)}`);
    throw error;
  }
}

function goalMessage(g: Goal, p: GoalProgress, plan: GoalPlan | null) {
  const lines = [
    `🎯 <b>${esc(g.title)}</b>: ${formatVnd(g.target)} trước hết tháng ${formatMonth(g.deadline)}`,
    `Đã để dành: <b>${formatVnd(p.saved)}</b> (${p.percent}%) ${'▇'.repeat(Math.round(p.percent / 10)) || '▁'}`,
    p.monthsLeft > 0
      ? `Còn ${p.monthsLeft} tháng (tính cả tháng này) · từ giờ mỗi tháng cần để dành <b>${formatVnd(p.needFromNow)}</b>`
      : p.saved >= g.target
        ? '🎉 Đã đạt mục tiêu!'
        : `Đã quá hạn, còn thiếu ${formatVnd(g.target - p.saved)}.`,
  ];
  if (p.missingIncome.length) lines.push(`⚠️ Chưa nhập lương tháng ${p.missingIncome.map(formatMonth).join(', ')} nên chưa tính tiết kiệm tháng đó (/luong).`);
  if (!plan) return [...lines, '', 'Chưa có kế hoạch: /muctieu lai'].join('\n');

  lines.push('', `📋 <b>Kế hoạch mỗi tháng</b> (lương TB ${formatVnd(plan.income)}):`);
  for (const b of plan.budgets) {
    const change = b.action === 'giữ' ? `${formatVnd(b.target)} (giữ)` : `${formatVnd(b.current)} → <b>${formatVnd(b.target)}</b> (${b.action})`;
    lines.push(`${emojiOf(b.category)} ${b.category}: ${change}${b.reason ? `\n   <i>${esc(b.reason)}</i>` : ''}`);
  }
  const enough = plan.plannedSaving >= plan.need;
  lines.push(
    '',
    `${plan.dataDays >= 30 ? `Tổng chi: ${formatVnd(plan.currentSpend)} → ` : `Đã chi tới giờ ${formatVnd(plan.currentSpend)} · kế hoạch chi `}<b>${formatVnd(plan.plannedSpend)}</b>/tháng · để dành ${formatVnd(plan.plannedSaving)}/tháng ${enough ? '✅ đủ' : `❌ thiếu ${formatVnd(plan.need - plan.plannedSaving)}`}`,
  );
  if (plan.dataDays < 30) lines.push(`<i>Mới có ${plan.dataDays} ngày dữ liệu nên kế hoạch còn ước lượng; ghi thêm rồi /muctieu lai.</i>`);
  if (plan.summary) lines.push('', `💡 ${esc(plan.summary)}`);
  for (const t of plan.tips) lines.push(`• ${esc(t)}`);
  return lines.join('\n').slice(0, 4000);
}

// ---------- Số dư ----------

async function balance(env: Env, chatId: number, arg: string, today: string) {
  if (arg) {
    const found = takeAmount(arg, 0);
    if (!found) return send(env, chatId, 'VD: <code>/sodu 15tr</code> (tổng tiền mặt + tài khoản đang có)');
    await setBalance(env, chatId, found.amount, today);
  }
  const f = await forecast(env, chatId, today);
  if (!f) return send(env, chatId, '💵 Chưa nhập số dư. Gõ <code>/sodu 15tr</code> với tổng tiền mặt + tài khoản bạn đang có.');
  return send(env, chatId, (arg ? '✅ Đã lưu số dư.\n\n' : '') + forecastMessage(f), salaryButtons(f));
}

function forecastMessage(f: Forecast) {
  const b = f.balance;
  const sign = (n: number) => (n < 0 ? `<b>−${formatVnd(-n)}</b> ⚠️` : `<b>${formatVnd(n)}</b>`);
  const line = (l: ForecastLine) =>
    `  ${l.amount >= 0 ? '+' : '−'} ${esc(l.label)}${l.day ? ` (ngày ${formatDay(l.day)})` : ''}: ${formatVnd(Math.abs(l.amount))}`;
  const lines = [
    `💵 <b>Đang có: ${formatVndFull(b.now)}</b>`,
    b.incomeSince || b.spentSince || b.debtSince
      ? `<i>(nhập ${formatVnd(b.snapshot.amount)} ngày ${formatDay(b.snapshot.day)}${b.incomeSince ? ` + thu ${formatVnd(b.incomeSince)}` : ''}${b.spentSince ? ` − chi ${formatVnd(b.spentSince)}` : ''}${b.debtSince ? ` ${b.debtSince > 0 ? '+' : '−'} sổ nợ ${formatVnd(Math.abs(b.debtSince))}` : ''})</i>`
      : `<i>(nhập ngày ${formatDay(b.snapshot.day)})</i>`,
  ];
  for (const p of [f.current, f.next]) {
    lines.push('', `📅 <b>${p.label}</b>`, ...p.lines.map(line), `  ≈ Còn: ${sign(p.end)}`);
  }
  if (f.pendingSalary.length) lines.push('', '<i>Lương chưa cộng vào số dư cho tới khi bạn bấm nút nhận bên dưới.</i>');
  else if (f.salaryDue) lines.push('', '<i>Đã tới ngày lương. Lương về rồi thì bấm nút dưới (số khác thì gõ /luong 32tr).</i>');
  return lines.join('\n');
}

// ---------- Sổ nợ ----------

const owesLine = (d: Debt, today: string) =>
  `• ${esc(d.person)}: <b>${formatVnd(d.remaining)}</b>${d.paid ? ` <i>(đã trả ${formatVnd(d.paid)})</i>` : ''}${
    d.due_on ? (d.due_on < today ? ` ⚠️ quá hạn ${formatDay(d.due_on)}` : ` · hẹn ${formatDay(d.due_on)}`) : ''
  }${d.note ? ` · ${esc(d.note)}` : ''}`;

/** Câu sổ nợ trong tin nhắn thường. Trả về true nếu đã xử lý (false = để ghi như chi tiêu). */
async function debtMessage(env: Env, chatId: number, text: string, messageId: number, today: string) {
  const intent = parseDebt(text, today);
  if (!intent) return false;
  const { kind, person, amount, due, note } = intent;
  if (kind === 'lend' || kind === 'borrow') {
    await addDebt(env, chatId, { direction: kind, person, amount: amount!, note, start_on: today, due_on: due, message_id: messageId });
    const total = (await openDebtsWith(env, chatId, kind, person)).reduce((s, d) => s + d.remaining, 0);
    await send(
      env,
      chatId,
      [
        kind === 'lend'
          ? `🤝 Đã ghi: <b>${esc(person)}</b> nợ bạn <b>${formatVnd(amount!)}</b>${due ? ` · hẹn trả ${formatDay(due)}` : ''}`
          : `🤝 Đã ghi: bạn nợ <b>${esc(person)}</b> <b>${formatVnd(amount!)}</b>${due ? ` · hẹn trả ${formatDay(due)}` : ''}`,
        total !== amount ? (kind === 'lend' ? `Tổng ${esc(person)} đang nợ bạn: <b>${formatVnd(total)}</b>` : `Tổng bạn đang nợ ${esc(person)}: <b>${formatVnd(total)}</b>`) : '',
        `<i>${kind === 'lend' ? 'Đã trừ' : 'Đã cộng'} ${formatVnd(amount!)} ${kind === 'lend' ? 'khỏi' : 'vào'} số dư (không tính là chi tiêu). Nợ cũ từ trước thì sửa trên trang Sổ nợ.</i>`,
        due ? '' : '<i>Thêm hẹn trả: ghi kèm "hẹn 15/11" để bot nhắc đúng ngày.</i>',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    return true;
  }
  // Trả nợ: chỉ khi đang có khoản nợ mở với người đó.
  const direction = kind === 'repaid' ? 'lend' : 'borrow';
  if (!(await openDebtsWith(env, chatId, direction, person)).length) return false;
  const r = await payPerson(env, chatId, direction, person, amount, today);
  await send(
    env,
    chatId,
    [
      kind === 'repaid' ? `✅ <b>${esc(person)}</b> trả bạn <b>${formatVnd(r.paid)}</b>` : `✅ Bạn trả <b>${esc(person)}</b> <b>${formatVnd(r.paid)}</b>`,
      r.remaining
        ? kind === 'repaid'
          ? `${esc(person)} còn nợ bạn: <b>${formatVnd(r.remaining)}</b>`
          : `Bạn còn nợ ${esc(person)}: <b>${formatVnd(r.remaining)}</b>`
        : '🎉 Đã trả hết.',
      r.overpaid ? `<i>Dư ${formatVnd(r.overpaid)} so với số còn nợ, phần dư không được ghi.</i>` : '',
      `<i>${kind === 'repaid' ? 'Đã cộng vào' : 'Đã trừ khỏi'} số dư.</i>`,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  return true;
}

/** /no: xem sổ nợ · /no xoa: xóa khoản vừa ghi. */
async function debtCommand(env: Env, chatId: number, arg: string, today: string) {
  if (/^(xoa|xóa)$/i.test(arg)) {
    const last = await env.DB.prepare('SELECT id, person, amount FROM debts WHERE chat_id = ? ORDER BY id DESC LIMIT 1')
      .bind(chatId)
      .first<{ id: number; person: string; amount: number }>();
    if (!last) return send(env, chatId, 'Sổ nợ đang trống.');
    await deleteDebt(env, chatId, last.id);
    return send(env, chatId, `🗑️ Đã xóa khoản nợ ${esc(last.person)} ${formatVnd(last.amount)} (kèm các lần trả).`);
  }
  const debts = await listDebts(env, chatId);
  if (!debts.length) {
    return send(env, chatId, '📒 Sổ nợ trống. Ghi: <code>cho Nam mượn 500k hẹn 15/11</code> hoặc <code>vay Hùng 2tr</code>');
  }
  const t = debtTotals(debts);
  const lend = debts.filter((d) => d.direction === 'lend');
  const borrow = debts.filter((d) => d.direction === 'borrow');
  return send(
    env,
    chatId,
    [
      '📒 <b>Sổ nợ</b>',
      ...(lend.length ? ['', `<b>Người khác nợ bạn: ${formatVndFull(t.owedToMe)}</b>`, ...lend.map((d) => owesLine(d, today))] : []),
      ...(borrow.length ? ['', `<b>Bạn đang nợ: ${formatVndFull(t.iOwe)}</b>`, ...borrow.map((d) => owesLine(d, today))] : []),
      '',
      'Ghi trả: <code>Nam trả 200k</code> · <code>trả Hùng 1tr</code> · <code>Nam trả hết</code>',
    ].join('\n'),
  );
}

/** Nút "đã trả đủ" trong tin nhắc hạn nợ. */
async function debtButton(env: Env, chatId: number, q: TgCallback, id: number, today: string) {
  if (!Number.isInteger(id) || id <= 0) return answerCallback(env, q.id);
  const debt = await getDebt(env, chatId, id);
  const paid = debt ? await payDebt(env, chatId, id, null, today) : 0;
  await removeButtons(env, chatId, q.message!.message_id);
  if (!debt || !paid) return answerCallback(env, q.id, 'Khoản này đã xong rồi');
  await answerCallback(env, q.id, 'Đã ghi trả đủ');
  await send(
    env,
    chatId,
    debt.direction === 'lend'
      ? `✅ <b>${esc(debt.person)}</b> đã trả bạn ${formatVnd(paid)}. Đã cộng vào số dư.`
      : `✅ Đã ghi bạn trả <b>${esc(debt.person)}</b> ${formatVnd(paid)}. Đã trừ khỏi số dư.`,
  );
}

// ---------- Dư nợ trả sau (thẻ tín dụng, MoMo / ZaloPay / SPayLater trả sau) ----------

/** Tổng theo từng nguồn, VD "MoMo 300k · thẻ TD 1,2tr". */
function byProvider(rows: CreditCharge[]) {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.provider, (totals.get(r.provider) ?? 0) + r.amount);
  return [...totals].map(([k, v]) => `${paylaterInfo(k).short} ${formatVnd(v)}`).join(' · ');
}

/** Tách nguồn ở đầu câu: "momo phở 45k" -> momo + "phở 45k"; không có thì dùng fallback. */
function splitProvider(arg: string, fallback?: PaylaterKey): { provider?: PaylaterKey; rest: string } {
  const [first = '', ...rest] = arg.trim().split(/\s+/);
  const provider = matchPaylater(first.replace(/[:,]$/, ''));
  return provider ? { provider, rest: rest.join(' ').replace(/^[:-]\s*/, '') } : { provider: fallback, rest: arg.trim() };
}

async function creditLine(env: Env, chatId: number) {
  const rows = await pendingCharges(env, chatId);
  if (!rows.length) return '';
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  return `💳 Dư nợ trả sau: ${formatVnd(sum)} (${byProvider(rows)}) → trừ ngày 1/${formatMonth(billedMonth(rows[rows.length - 1].spent_on))} (/the)`;
}

async function credit(env: Env, chatId: number, arg: string, messageId: number, fallback: PaylaterKey = 'card') {
  if (!arg) {
    const rows = await pendingCharges(env, chatId);
    if (!rows.length) return send(env, chatId, '💳 Không có dư nợ trả sau. Ghi: <code>td phở 45k</code> (thẻ) hoặc <code>ts momo phở 45k</code>');
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    const lines = [
      `💳 <b>Dư nợ trả sau</b>: ${formatVndFull(sum)} (${rows.length} khoản)`,
      `Trừ vào ngày 1/${formatMonth(billedMonth(rows[rows.length - 1].spent_on))} (thành chi tiêu của tháng đó, vào đúng hũ).`,
    ];
    for (const p of PAYLATER) {
      const group = rows.filter((r) => r.provider === p.key);
      if (!group.length) continue;
      lines.push('', `<b>${p.name}</b>: ${formatVndFull(group.reduce((s, r) => s + r.amount, 0))}`);
      lines.push(...group.slice(0, 20).map((r) => `  ${formatDay(r.spent_on)} ${emojiOf(r.category)} ${esc(r.item)}: <b>${formatVnd(r.amount)}</b>`));
    }
    lines.push('', 'Trả sớm: <code>/the tra</code> · <code>/the tra momo</code> · <code>/the tra 2tr</code>');
    return send(env, chatId, lines.join('\n'));
  }
  // "/the tra" = trả sớm hết, "/the tra momo" = chỉ trả MoMo, "/the tra 2tr" = trả một phần.
  const pay = arg.match(/^(?:tra|trả|thanh toan|thanh toán)(?:\s+(.+))?$/i);
  if (pay) return payCard(env, chatId, pay[1] ?? '');
  if (['xoa', 'xóa'].includes(arg.toLowerCase())) {
    const last = await env.DB.prepare('SELECT id, message_id FROM credit_charges WHERE chat_id = ? AND settled = 0 ORDER BY id DESC LIMIT 1')
      .bind(chatId)
      .first<{ id: number; message_id: number | null }>();
    if (!last) return send(env, chatId, 'Không có khoản trả sau nào để xóa.');
    const removed = await (last.message_id === null
      ? env.DB.prepare('DELETE FROM credit_charges WHERE id = ? RETURNING item, amount').bind(last.id)
      : env.DB.prepare('DELETE FROM credit_charges WHERE chat_id = ? AND settled = 0 AND message_id = ? RETURNING item, amount').bind(chatId, last.message_id)
    ).all<{ item: string; amount: number }>();
    return send(env, chatId, `🗑️ Đã xóa khỏi dư nợ trả sau: ${removed.results.map((r) => `${esc(r.item)} ${formatVnd(r.amount)}`).join(', ')}`);
  }

  const { provider, rest } = splitProvider(arg, fallback);
  const parsed = await parseExpense(env, rest);
  if (parsed.items.length === 0) return send(env, chatId, '🤔 Mình không thấy khoản nào. VD: <code>td phở 45k</code> hoặc <code>ts momo phở 45k</code>');
  return creditParsed(env, chatId, parsed, messageId, provider ?? fallback);
}

/** Trả sớm: "" = trả hết, "momo" = chỉ MoMo, "2tr" = một phần, "momo 500k" = một phần của MoMo. */
async function payCard(env: Env, chatId: number, arg: string) {
  const { provider, rest } = splitProvider(arg);
  const pending = (await pendingCharges(env, chatId)).filter((c) => !provider || c.provider === provider);
  const debt = pending.reduce((s, c) => s + c.amount, 0);
  const label = provider ? paylaterInfo(provider).name : 'dư nợ trả sau';
  if (!debt) return send(env, chatId, `💳 Không có ${provider ? `dư nợ ${label}` : 'dư nợ trả sau'} để trả.`);
  let amount: number | null = null;
  if (rest && !/^(het|hết|tat ca|tất cả)$/i.test(rest)) {
    amount = takeAmount(rest, 1000)?.amount ?? null;
    if (!amount) return send(env, chatId, 'VD: <code>/the tra</code> (trả hết), <code>/the tra momo</code>, <code>/the tra 2tr</code> (một phần).');
    if (amount >= debt) amount = null;
  }
  const today = vnDate(Date.now());
  const result = await payEarly(env, chatId, amount, today, provider);
  if (!result.paid) return send(env, chatId, 'Không trả được khoản nào (có thể vừa được trả ở nơi khác). Xem lại: /the');
  const left = await pendingCharges(env, chatId);
  return send(
    env,
    chatId,
    [
      `💳 <b>Đã thanh toán sớm ${formatVndFull(result.paid)}</b>${provider ? ` (${label})` : ''}`,
      ...result.items.map(
        (i) => `${esc(i.item)} (${paylaterInfo(i.provider).short}, mua ${formatDay(i.spent_on)}): ${formatVnd(i.amount)}${i.partial ? ' <i>(một phần)</i>' : ''}`,
      ),
      '',
      `Đã thành chi tiêu hôm nay (${formatDay(today)}), trừ vào số dư và tính vào hũ tháng ${formatMonth(monthOf(today))}.`,
      left.length
        ? `Còn dư nợ trả sau: <b>${formatVndFull(left.reduce((s, c) => s + c.amount, 0))}</b> (${byProvider(left)}), trừ vào ngày 1/${formatMonth(billedMonth(left[left.length - 1].spent_on))}.`
        : '✅ Hết dư nợ trả sau.',
    ].join('\n'),
  );
}

async function creditParsed(
  env: Env,
  chatId: number,
  parsed: Parsed & { source: string },
  messageId: number,
  provider: PaylaterKey = 'card',
  header?: string,
) {
  const today = vnDate(Date.now());
  const day = vnDate(Date.now(), parsed.dayOffset);
  await addCharges(env, chatId, parsed.items, day, messageId, provider);
  const pending = await pendingCharges(env, chatId);
  const sum = pending.reduce((s, r) => s + r.amount, 0);
  const sent = await send(
    env,
    chatId,
    [
      ...(header ? [header] : []),
      `💳 Trả sau qua <b>${paylaterInfo(provider).name}</b>`,
      ...parsed.items.map((i) => `${emojiOf(i.category)} ${esc(i.item)}: <b>${formatVnd(i.amount)}</b> <i>(${i.category})</i>`),
      '',
      `Dư nợ trả sau: <b>${formatVndFull(sum)}</b> (${byProvider(pending)}) · trừ vào ngày 1/${formatMonth(billedMonth(day))}, không tính vào tháng ${formatMonth(monthOf(day))}.`,
      day < `${monthOf(today)}-01` ? '<i>Khoản này của tháng trước nên sẽ chuyển vào chi tiêu ngay đêm nay.</i>' : '',
      parsed.source === 'fallback' ? '<i>AI đang bận nên mình đọc tạm, danh mục để "Khác". Reply tin này để sửa.</i>' : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  await remember(env, chatId, sent, 'credit', messageId);
}

// ---------- Chi cố định hàng tháng ----------

async function fixed(env: Env, chatId: number, arg: string, today: string) {
  const rows = (await listRecurring(env, chatId)).filter((r) => r.active === 1);
  const [action, num] = arg.split(/\s+/);
  const pick = () => rows[Number(num) - 1];

  if (!arg) {
    if (!rows.length) return send(env, chatId, 'Chưa có khoản cố định nào. VD: <code>/codinh tiền nhà 5tr ngày 5</code>');
    const month = monthOf(today);
    return send(
      env,
      chatId,
      [
        `🔁 <b>Chi cố định hàng tháng</b>: ${formatVndFull(rows.reduce((s, r) => s + r.amount, 0))}`,
        ...rows.map(
          (r, i) =>
            `${i + 1}. ${emojiOf(r.category)} ${esc(r.item)}: <b>${formatVnd(r.amount)}</b> · ngày ${r.day}${
              r.last_month === month ? ' ✅ đã trừ tháng này' : r.start_month > month ? ` · bắt đầu tháng ${formatMonth(r.start_month)}` : ''
            }`,
        ),
        '',
        'Bỏ: <code>/codinh xoa 1</code> · Trừ luôn tháng này: <code>/codinh tru 1</code>',
      ].join('\n'),
    );
  }
  if (['xoa', 'xóa'].includes(action.toLowerCase()) && /^\d+$/.test(num ?? '')) {
    const r = pick();
    if (!r) return send(env, chatId, 'Không có khoản số đó. Xem danh sách: /codinh');
    await env.DB.prepare('UPDATE recurring SET active = 0 WHERE id = ?').bind(r.id).run();
    return send(env, chatId, `🗑️ Đã bỏ khoản cố định "${esc(r.item)}". Các lần đã trừ trước vẫn giữ.`);
  }
  if (['tru', 'trừ'].includes(action.toLowerCase()) && /^\d+$/.test(num ?? '')) {
    const r = pick();
    if (!r) return send(env, chatId, 'Không có khoản số đó. Xem danh sách: /codinh');
    const done = await chargeOne(env, r, today);
    return send(env, chatId, done ? chargedMessage([r]) : `"${esc(r.item)}" đã trừ tháng này rồi.`);
  }

  // Thêm mới: "tiền nhà 5tr ngày 5"
  const dayMatch = arg.match(/(?:vào\s+)?(?:ngày|mùng|mồng)\s*(\d{1,2})/i);
  const day = dayMatch ? Number(dayMatch[1]) : 1;
  const found = takeAmount(dayMatch ? arg.replace(dayMatch[0], ' ') : arg, 1000);
  if (!found || day < 1 || day > 31) return send(env, chatId, 'VD: <code>/codinh tiền nhà 5tr ngày 5</code> (không ghi ngày thì trừ ngày 1)');
  const item = found.rest.replace(/[\s,.;:-]+$/, '').trim().slice(0, 80) || 'Chi cố định';
  // Nhờ AI chọn danh mục; AI lỗi thì để "Hóa đơn & nhà cửa" (đa số khoản cố định là vậy).
  const parsed = await parseExpense(env, `${item} ${found.amount}`);
  const category = parsed.source !== 'fallback' && parsed.items[0] ? parsed.items[0].category : 'Hóa đơn & nhà cửa';
  const { row, passed } = await addRecurring(env, chatId, { item, amount: found.amount, category, day }, today, false);
  const index = (await listRecurring(env, chatId)).filter((r) => r.active === 1).findIndex((r) => r.id === row.id) + 1;
  const month = monthOf(today);
  return send(
    env,
    chatId,
    [
      `🔁 Đã thêm khoản cố định: ${emojiOf(category)} <b>${esc(item)}</b> ${formatVnd(found.amount)} <i>(${category})</i>, trừ ngày ${day} hằng tháng.`,
      passed
        ? `Tháng này đã qua ngày ${dueDay(row, month)} nên bắt đầu trừ từ tháng sau. Nếu tháng này chưa ghi khoản này: <code>/codinh tru ${index}</code>`
        : `Sẽ tự trừ vào ngày ${dueDay(row, month)}/${Number(month.slice(5))}.`,
    ].join('\n'),
  );
}

// ---------- Cài đặt ----------

type Settings = { chat_id: number; home_city: string | null; active_trip_id: number | null };

const getSettings = (env: Env, chatId: number) =>
  env.DB.prepare('SELECT * FROM settings WHERE chat_id = ?').bind(chatId).first<Settings>();

async function homeCity(env: Env, chatId: number) {
  return (await getSettings(env, chatId))?.home_city || env.DEFAULT_HOME_CITY;
}

async function upsertSettings(env: Env, chatId: number, change: Partial<Omit<Settings, 'chat_id'>>) {
  const current = (await getSettings(env, chatId)) ?? { chat_id: chatId, home_city: null, active_trip_id: null };
  const next = { ...current, ...change };
  await env.DB.prepare(
    `INSERT INTO settings (chat_id, home_city, active_trip_id) VALUES (?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET home_city = excluded.home_city, active_trip_id = excluded.active_trip_id`,
  )
    .bind(chatId, next.home_city, next.active_trip_id)
    .run();
}


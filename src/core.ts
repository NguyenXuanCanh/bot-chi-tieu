/** Hàm thuần dùng chung (không phụ thuộc Worker), có test trong test/core.test.ts. */

export const CATEGORIES = [
  { name: 'Ăn uống', emoji: '🍜' },
  { name: 'Cà phê & đồ uống', emoji: '☕' },
  { name: 'Di chuyển', emoji: '🚕' },
  { name: 'Lưu trú', emoji: '🏨' },
  { name: 'Vé tham quan & vui chơi', emoji: '🎡' },
  { name: 'Mua sắm', emoji: '🛍️' },
  { name: 'Quà tặng', emoji: '🎁' },
  { name: 'Hóa đơn & nhà cửa', emoji: '🏠' },
  { name: 'Sức khỏe', emoji: '💊' },
  { name: 'Nạp game', emoji: '🎮' },
  { name: 'Khác', emoji: '📦' },
] as const;
export type Category = (typeof CATEGORIES)[number]['name'];
export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name) as Category[];

export const emojiOf = (category: string) => CATEGORIES.find((c) => c.name === category)?.emoji ?? '📦';
export const toCategory = (value: unknown): Category =>
  CATEGORY_NAMES.includes(value as Category) ? (value as Category) : 'Khác';

/** 45000 -> "45k", 1250000 -> "1,25tr", 2000000 -> "2tr". */
export function formatVnd(value: number) {
  if (value === 0) return '0đ';
  if (Math.abs(value) >= 1_000_000) {
    const millions = Math.round(value / 10_000) / 100;
    return `${String(millions).replace('.', ',')}tr`;
  }
  return `${Math.round(value / 1000)}k`;
}

/** 1250000 -> "1.250.000đ" (con số đầy đủ cho tổng). */
export const formatVndFull = (value: number) => `${Math.round(value).toLocaleString('vi-VN')}đ`;

/** Bỏ dấu, chữ thường, bỏ tiền tố hành chính để so tên thành phố ("TP. Hồ Chí Minh" = "Sài Gòn"?). */
export function normalizeCity(city: string) {
  const plain = city
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[.,]/g, ' ')
    .replace(/\b(tp|thanh pho|tinh|quan|huyen|thi xa|city)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return CITY_ALIASES[plain] ?? plain;
}

/** Tên gọi khác của cùng một nơi. */
const CITY_ALIASES: Record<string, string> = {
  'sai gon': 'ho chi minh',
  hcm: 'ho chi minh',
  sg: 'ho chi minh',
  'hn': 'ha noi',
  'hanoi': 'ha noi',
  'da lat': 'da lat',
  dalat: 'da lat',
};

export const sameCity = (a?: string | null, b?: string | null) =>
  !!a && !!b && normalizeCity(a) === normalizeCity(b);

/** Ngày hôm nay theo giờ Việt Nam (UTC+7), dạng YYYY-MM-DD; dayOffset âm = những ngày trước. */
export function vnDate(now: number, dayOffset = 0) {
  const d = new Date(now + 7 * 3600_000 + dayOffset * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Số ngày giữa 2 ngày YYYY-MM-DD (b - a). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Cộng/trừ ngày cho chuỗi YYYY-MM-DD. */
export const addDays = (day: string, n: number) => new Date(Date.parse(day) + n * 86_400_000).toISOString().slice(0, 10);

export const formatDay = (day: string) => `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`;

/** Chuyến đi tự động: chi ở cùng một nơi cách nhau không quá ngần này ngày thì gộp làm một chuyến. */
export const TRIP_GAP_DAYS = 2;

export type ParsedItem = { item: string; amount: number; category: Category };
export type Parsed = { items: ParsedItem[]; city: string | null; place: string | null; dayOffset: number };

/**
 * Đọc số tiền kiểu Việt Nam: 45k, 45 nghìn, 1tr2, 1.2tr, 1,5 triệu, 120.000, 120000đ, 2 củ.
 * Trả về VND hoặc null.
 */
export function parseAmount(raw: string): number | null {
  const s = raw.toLowerCase().replace(/\s+/g, '');
  let m = s.match(/^(\d+)(?:tr|triệu|trieu|củ|cu)(\d{1,3})$/); // 1tr2 = 1.200.000
  if (m) return Number(m[1]) * 1_000_000 + Number(m[2].padEnd(3, '0')) * 1000;
  m = s.match(/^(\d+(?:[.,]\d+)?)(k|nghìn|nghin|ngàn|ngan|tr|triệu|trieu|củ|cu)$/);
  if (m) {
    const n = Number(m[1].replace(',', '.'));
    return Math.round(n * (/^(k|ngh|ng)/.test(m[2]) ? 1000 : 1_000_000));
  }
  m = s.match(/^(\d{1,3}(?:[.,]\d{3})+|\d+)(?:đ|d|vnd|vnđ)?$/);
  if (m) {
    const n = Number(m[1].replace(/[.,]/g, ''));
    return n >= 1000 ? n : null; // "45" một mình quá mơ hồ
  }
  return null;
}

/**
 * Đọc dự phòng khi AI không trả lời: "phở 45k, cafe 35k ở Đà Lạt".
 * Chỉ nhận dạng đơn giản; danh mục để "Khác".
 */
export function fallbackParse(text: string): Parsed {
  let body = text.trim();
  let city: string | null = null;
  // "@Hội An: ..." ở đầu (cần dấu : hoặc , để biết tên nơi dừng ở đâu), hoặc "... ở / tại / @ Đà Lạt" ở cuối.
  const lead = body.match(/^@([^:,;\n]+)[:,]\s*/);
  const tail = body.match(/(?:^|\s)(?:@|ở |tại )([^,;\n]+)$/i);
  if (lead) {
    city = lead[1].trim();
    body = body.slice(lead[0].length).trim();
  } else if (tail) {
    city = tail[1].trim();
    body = body.slice(0, tail.index).trim();
  }
  const dayOffset = /^hôm qua\b/i.test(body) ? -1 : 0;
  body = body.replace(/^hôm (qua|nay)\s*/i, '');
  const items: ParsedItem[] = [];
  for (const part of body.split(/[,;\n]+/)) {
    const tokens = part.trim().split(/\s+/);
    for (let i = tokens.length - 1; i >= 0; i--) {
      // Thử ghép 2 token cuối ("1,5 triệu") rồi 1 token.
      const two = i > 0 ? parseAmount(tokens.slice(i - 1, i + 1).join('')) : null;
      const one = parseAmount(tokens[i]);
      const amount = two ?? one;
      if (amount) {
        const name = tokens.filter((_, j) => (two ? j < i - 1 || j > i : j !== i)).join(' ').trim();
        if (name) items.push({ item: name, amount, category: 'Khác' });
        break;
      }
    }
  }
  return { items, city, place: city, dayOffset };
}

// ---------- Hũ chi tiêu & mục tiêu tiết kiệm ----------

export const JARS = [
  { key: 'bat_buoc', name: 'Chi tiêu bắt buộc', emoji: '🏠' },
  { key: 'tieu_xai', name: 'Tiêu xài', emoji: '🎉' },
  { key: 'game', name: 'Nạp game', emoji: '🎮' },
  { key: 'tiet_kiem', name: 'Tiết kiệm', emoji: '🐷' },
] as const;
export type JarKey = (typeof JARS)[number]['key'];
export const JAR_KEYS = JARS.map((j) => j.key) as JarKey[];
/** Hũ nhận khoản chi (hũ tiết kiệm không chi). */
export const SPEND_JARS: JarKey[] = JAR_KEYS.filter((k) => k !== 'tiet_kiem');
export const isJar = (v: unknown): v is JarKey => JAR_KEYS.includes(v as JarKey);
export const jarInfo = (key: string) => JARS.find((j) => j.key === key) ?? JARS[1];

/** Danh mục -> hũ mặc định (sửa được trên trang admin). */
export const DEFAULT_CATEGORY_JAR: Record<Category, JarKey> = {
  'Ăn uống': 'bat_buoc',
  'Cà phê & đồ uống': 'tieu_xai',
  'Di chuyển': 'bat_buoc',
  'Lưu trú': 'tieu_xai',
  'Vé tham quan & vui chơi': 'tieu_xai',
  'Mua sắm': 'tieu_xai',
  'Quà tặng': 'tieu_xai',
  'Hóa đơn & nhà cửa': 'bat_buoc',
  'Sức khỏe': 'bat_buoc',
  'Nạp game': 'game',
  Khác: 'tieu_xai',
};

/** "2026-10-22" -> "2026-10". */
export const monthOf = (day: string) => day.slice(0, 7);
export const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** Cộng tháng cho "YYYY-MM". */
export function addMonths(month: string, n: number) {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Số tháng từ a tới b ("2026-10" -> "2027-02" = 4). */
export const monthsBetween = (a: string, b: string) =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

export const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/** "2026-10" -> "10/2026". */
export const formatMonth = (month: string) => `${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;

/** Tìm số tiền đầu tiên trong chuỗi (thử ghép 2 từ như "1,5 triệu"). Trả về số tiền và đoạn còn lại. */
export function takeAmount(text: string, min = 0): { amount: number; rest: string } | null {
  const tokens = text.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const two = i + 1 < tokens.length ? parseAmount(tokens[i] + tokens[i + 1]) : null;
    const amount = two ?? parseAmount(tokens[i]);
    if (amount && amount >= min) {
      const rest = tokens.filter((_, j) => j !== i && !(two && j === i + 1)).join(' ');
      return { amount, rest };
    }
  }
  return null;
}

/**
 * Đọc mục tiêu tiết kiệm: "50tr tới tháng 2 năm sau để mua laptop", "30tr sau 6 tháng", "100tr 12/2027".
 * deadline là tháng cuối cùng (tính cả tháng đó), tính từ tháng hiện tại.
 */
export function parseGoal(text: string, today: string): { target: number; deadline: string; title: string } | null {
  const found = takeAmount(text, 100_000); // bỏ qua số năm như "2027"
  if (!found) return null;
  let rest = found.rest;
  const current = monthOf(today);
  const year = Number(today.slice(0, 4));
  const curMonth = Number(today.slice(5, 7));
  let deadline: string | null = null;

  const pick = (re: RegExp, make: (m: RegExpMatchArray) => string | null) => {
    if (deadline) return;
    const m = rest.match(re);
    if (!m) return;
    const value = make(m);
    if (value) {
      deadline = value;
      rest = rest.replace(m[0], ' ');
    }
  };
  const fmt = (y: number, mo: number) => (mo >= 1 && mo <= 12 ? `${y}-${String(mo).padStart(2, '0')}` : null);
  // "sau 6 tháng" / "trong 6 tháng" / "6 tháng nữa"
  pick(/(?:sau|trong)\s+(\d{1,2})\s*tháng(?:\s*nữa)?|(\d{1,2})\s*tháng\s*nữa/i, (m) => addMonths(current, Number(m[1] ?? m[2])));
  // "tháng 2/2027", "2/2027", "T2 2027"
  pick(/(?:tháng\s*|t)?(\d{1,2})\s*[/\-\s]\s*(20\d{2})/i, (m) => fmt(Number(m[2]), Number(m[1])));
  // "tháng 2 năm sau" / "tháng 2" (tháng đã qua trong năm nay thì hiểu là năm sau)
  pick(/tháng\s*(\d{1,2})(\s*năm\s*(?:sau|tới))?/i, (m) => {
    const mo = Number(m[1]);
    return fmt(m[2] || mo < curMonth ? year + 1 : year, mo);
  });
  pick(/(?:cuối|hết)\s*năm\s*(?:sau|tới)/i, () => `${year + 1}-12`);
  pick(/(?:cuối|hết)\s*năm(?:\s*nay)?/i, () => `${year}-12`);
  // TS không thấy `deadline` được gán bên trong pick().
  const end = deadline as string | null;
  if (!end || end < current) return null;

  const why = rest.match(/(?:để|cho|:)\s*(.+)$/i);
  const title = (why?.[1] ?? '').replace(/[\s,.;:]+$/, '').trim().slice(0, 80) || 'Tiết kiệm';
  return { target: found.amount, deadline: end, title };
}

// ---------- Sửa nhanh bằng reply ----------

/** Chữ thường, bỏ dấu, gộp khoảng trắng. */
export const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Từ người dùng hay gõ -> danh mục. So khớp trên chữ không dấu, cụm dài trước. */
const CATEGORY_ALIASES: [string, Category][] = [
  ...CATEGORY_NAMES.map((c) => [plain(c), c] as [string, Category]),
  ['ca phe', 'Cà phê & đồ uống'],
  ['cafe', 'Cà phê & đồ uống'],
  ['do uong', 'Cà phê & đồ uống'],
  ['tra sua', 'Cà phê & đồ uống'],
  ['an uong', 'Ăn uống'],
  ['do an', 'Ăn uống'],
  ['an', 'Ăn uống'],
  ['di lai', 'Di chuyển'],
  ['xang', 'Di chuyển'],
  ['khach san', 'Lưu trú'],
  ['homestay', 'Lưu trú'],
  ['vui choi', 'Vé tham quan & vui chơi'],
  ['giai tri', 'Vé tham quan & vui chơi'],
  ['tham quan', 'Vé tham quan & vui chơi'],
  ['ve', 'Vé tham quan & vui chơi'],
  ['shopping', 'Mua sắm'],
  ['qua', 'Quà tặng'],
  ['hoa don', 'Hóa đơn & nhà cửa'],
  ['nha cua', 'Hóa đơn & nhà cửa'],
  ['dien nuoc', 'Hóa đơn & nhà cửa'],
  ['thuoc', 'Sức khỏe'],
  ['game', 'Nạp game'],
];

/** "cafe" / "đổi sang ăn uống" -> danh mục, null nếu không khớp. */
export function matchCategory(text: string): Category | null {
  // Bỏ cụm chỉ ngày trước ("hôm qua" chứa "qua" = quà tặng).
  const t = ` ${plain(text.replace(/\b\d{1,2}\/\d{1,2}\b/g, ' '))
    .replace(/\bhom (qua|kia|nay)\b/g, ' ')
    .trim()
    .replace(/^(doi )?(sang |thanh |la )?/, '')} `;
  const sorted = [...CATEGORY_ALIASES].sort((a, b) => b[0].length - a[0].length);
  for (const [alias, category] of sorted) if (t.includes(` ${alias} `)) return category;
  return null;
}

/** "hôm qua" / "hôm kia" / "hôm nay" / "20/10" -> YYYY-MM-DD (không quá hôm nay), null nếu không có. */
export function matchDay(text: string, today: string): string | null {
  const t = plain(text);
  if (/\bhom kia\b/.test(t)) return addDays(today, -2);
  if (/\bhom qua\b/.test(t)) return addDays(today, -1);
  if (/\bhom nay\b/.test(t)) return today;
  const m = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (!m) return null;
  const [d, mo] = [Number(m[1]), Number(m[2])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let year = Number(today.slice(0, 4));
  let day = `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (day > today) day = `${--year}-${day.slice(5)}`;
  return day;
}

// ---------- Dư nợ trả sau ----------

/** Nguồn trả sau: thẻ tín dụng và các ví trả sau. Tất cả trừ vào ngày 1 tháng sau. */
export const PAYLATER = [
  { key: 'card', name: 'Thẻ tín dụng', short: 'thẻ TD' },
  { key: 'momo', name: 'MoMo Ví Trả Sau', short: 'MoMo' },
  { key: 'zalopay', name: 'ZaloPay Trả Sau', short: 'ZaloPay' },
  { key: 'spaylater', name: 'SPayLater (ShopeePay)', short: 'SPayLater' },
  { key: 'other', name: 'Trả sau khác', short: 'trả sau' },
] as const;
export type PaylaterKey = (typeof PAYLATER)[number]['key'];
export const isPaylater = (v: unknown): v is PaylaterKey => PAYLATER.some((p) => p.key === v);
export const paylaterInfo = (key: string) => PAYLATER.find((p) => p.key === key) ?? PAYLATER[0];

/** Từ người dùng gõ -> nguồn trả sau ("momo", "zalo", "spay", "shopee", "td", "thẻ"…), null nếu không phải. */
export function matchPaylater(word: string): PaylaterKey | null {
  const w = plain(word).replace(/\s+/g, '');
  if (['td', 'the', 'thetd', 'tindung', 'thetindung', 'card', 'visa', 'master'].includes(w)) return 'card';
  if (['momo', 'vitrasau', 'momotrasau'].includes(w)) return 'momo';
  if (['zalo', 'zalopay', 'zlp', 'zalopaytrasau'].includes(w)) return 'zalopay';
  if (['spay', 'spaylater', 'shopee', 'shopeepay', 'shopeepaylater'].includes(w)) return 'spaylater';
  if (['khac', 'other'].includes(w)) return 'other';
  return null;
}

// ---------- Kỳ chi tiêu (tháng tính từ ngày nhận lương) ----------

/** Cùng ngày tháng sau, tháng ngắn thì ngày cuối tháng: 2026-01-31 -> 2026-02-28. */
export function sameDayNextMonth(day: string) {
  const next = addMonths(monthOf(day), 1);
  return `${next}-${String(Math.min(Number(day.slice(8, 10)), daysInMonth(next))).padStart(2, '0')}`;
}

export type Period = {
  /** cycle: ngày bắt đầu "YYYY-MM-DD"; month: "YYYY-MM". */
  key: string;
  kind: 'cycle' | 'month';
  from: string;
  to: string;
  /** Kỳ hiện tại chưa có kỳ sau: `to` là ngày dự kiến kết thúc (trước ngày lương tháng sau). */
  open: boolean;
  label: string;
};

export function monthPeriod(month: string): Period {
  return {
    key: month,
    kind: 'month',
    from: `${month}-01`,
    to: `${month}-${String(daysInMonth(month)).padStart(2, '0')}`,
    open: false,
    label: `Tháng ${formatMonth(month)}`,
  };
}

/**
 * Các kỳ từ danh sách ngày bắt đầu (bấm nhận lương / bắt đầu tháng), mới nhất trước.
 * Kỳ i kéo tới hết ngày trước kỳ sau; kỳ mới nhất dự kiến hết trước cùng ngày tháng sau (quá hạn mà chưa bắt đầu kỳ mới thì kéo tới hôm nay).
 */
export function cyclePeriods(starts: string[], today: string): Period[] {
  const sorted = [...new Set(starts)].filter((s) => s <= today).sort().reverse();
  return sorted.map((from, i) => {
    const open = i === 0;
    const expected = addDays(sameDayNextMonth(from), -1);
    const to = open ? (expected < today ? today : expected) : addDays(sorted[i - 1], -1);
    return { key: from, kind: 'cycle', from, to, open, label: `Kỳ ${formatDay(from)} → ${formatDay(to)}` };
  });
}

/** Kỳ chứa ngày `day`: theo kỳ lương nếu có, không thì theo tháng lịch. */
export function periodOf(starts: string[], day: string, today: string): Period {
  const cycles = cyclePeriods(starts, today);
  return cycles.find((p) => p.from <= day && day <= p.to) ?? monthPeriod(monthOf(day));
}

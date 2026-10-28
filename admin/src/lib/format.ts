import {
  BedDouble,
  Car,
  Coffee,
  Gamepad2,
  Gift,
  HeartPulse,
  Home,
  Package,
  PartyPopper,
  PiggyBank,
  ShoppingBag,
  Ticket,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';

/** Danh mục giống bot (src/core.ts), mỗi cái một icon + màu riêng (đủ tương phản trên nền trắng). */
export const CATEGORY_STYLE: Record<string, { icon: LucideIcon; color: string }> = {
  'Ăn uống': { icon: UtensilsCrossed, color: '#c2410c' },
  'Cà phê & đồ uống': { icon: Coffee, color: '#92400e' },
  'Di chuyển': { icon: Car, color: '#1d4ed8' },
  'Lưu trú': { icon: BedDouble, color: '#7c3aed' },
  'Vé tham quan & vui chơi': { icon: Ticket, color: '#db2777' },
  'Mua sắm': { icon: ShoppingBag, color: '#0f766e' },
  'Quà tặng': { icon: Gift, color: '#be123c' },
  'Hóa đơn & nhà cửa': { icon: Home, color: '#4d7c0f' },
  'Sức khỏe': { icon: HeartPulse, color: '#0e7490' },
  'Nạp game': { icon: Gamepad2, color: '#a21caf' },
  Khác: { icon: Package, color: '#475569' },
};
export const styleOf = (category: string) => CATEGORY_STYLE[category] ?? CATEGORY_STYLE['Khác'];

/** 45000 -> "45k", 1250000 -> "1,25tr". */
export function vndShort(value: number) {
  if (Math.abs(value) >= 1_000_000) return `${String(Math.round(value / 10_000) / 100).replace('.', ',')}tr`;
  return `${Math.round(value / 1000)}k`;
}

/** 1250000 -> "1.250.000 ₫". */
export const vnd = (value: number) => `${Math.round(value).toLocaleString('vi-VN')} ₫`;

/** "2026-10-22" -> "22/10" (kèm năm nếu khác năm nay). */
export function dayLabel(day: string, withYear = false) {
  const [y, m, d] = day.split('-');
  return withYear ? `${Number(d)}/${Number(m)}/${y}` : `${Number(d)}/${Number(m)}`;
}

export function dayRange(from: string, to: string) {
  return from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`;
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
export const addDays = (day: string, n: number) => new Date(Date.parse(day) + n * 86_400_000).toISOString().slice(0, 10);

/** Hôm nay theo giờ Việt Nam. */
export const todayVn = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/** % thay đổi so với kỳ trước (null nếu kỳ trước = 0). */
export const changePercent = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

/** Hũ chi tiêu giống bot (src/core.ts JARS). */
export const JAR_STYLE: Record<string, { icon: LucideIcon; color: string }> = {
  bat_buoc: { icon: Home, color: '#1d4ed8' },
  tieu_xai: { icon: PartyPopper, color: '#c2410c' },
  game: { icon: Gamepad2, color: '#a21caf' },
  tiet_kiem: { icon: PiggyBank, color: '#047857' },
};

/** Đọc số tiền gõ tay: "25tr", "1tr2", "1,5tr", "450k", "25.000.000". Trả null nếu không đọc được. */
export function parseMoney(raw: string): number | null {
  const s = raw.toLowerCase().replace(/\s+/g, '').replace(/[₫đ]$/, '');
  if (!s) return null;
  let m = s.match(/^(\d+)(?:tr|triệu|trieu|củ|cu)(\d{1,3})$/);
  if (m) return Number(m[1]) * 1_000_000 + Number(m[2].padEnd(3, '0')) * 1000;
  m = s.match(/^(\d+(?:[.,]\d+)?)(k|nghìn|ngàn|tr|triệu|trieu|củ|cu)$/);
  if (m) return Math.round(Number(m[1].replace(',', '.')) * (/^(k|ng)/.test(m[2]) ? 1000 : 1_000_000));
  m = s.match(/^(\d{1,3}(?:[.,]\d{3})+|\d+)$/);
  return m ? Number(m[1].replace(/[.,]/g, '')) : null;
}

/** "2026-10" -> "10/2026". */
export const monthLabel = (month: string) => `${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;
export function addMonths(month: string, n: number) {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

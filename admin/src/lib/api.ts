/** Gọi /admin/api với token đăng nhập. Hết hạn (401) thì phát sự kiện để quay về trang đăng nhập. */

const TOKEN_KEY = 'chi-tieu-admin-token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Trình duyệt chặn lưu trữ: vẫn dùng được trong phiên hiện tại qua biến bên dưới.
  }
  memoryToken = token;
}

let memoryToken: string | null = null;

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, unknown> } = {}) {
  const url = new URL(`/admin/api${path}`, window.location.origin);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const token = getToken() ?? memoryToken;
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError('Không kết nối được máy chủ', 0);
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (response.status === 401 && path !== '/login') {
    setToken(null);
    window.dispatchEvent(new Event('admin-logout'));
  }
  if (!response.ok) throw new ApiError(data.error ?? `Lỗi ${response.status}`, response.status);
  return data as T;
}

/** Tải file CSV (cần token nên không dùng link thường). */
export async function downloadCsv() {
  const token = getToken() ?? memoryToken;
  const response = await fetch('/admin/api/export.csv', { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new ApiError('Không xuất được dữ liệu', response.status);
  const blob = await response.blob();
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'chi-tieu.csv';
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  link.click();
  URL.revokeObjectURL(link.href);
}

// ---------- Kiểu dữ liệu từ API ----------

export type CategoryTotal = { category: string; total: number; count: number };
export type DayTotal = { day: string; total: number; travel?: number };
export type TripRow = {
  id: number;
  city: string;
  started_on: string;
  ended_on: string;
  manual?: number;
  total: number;
  count?: number;
  active?: number;
};
export type Summary = {
  from: string;
  to: string;
  days: number;
  total: number;
  count: number;
  travel: number;
  perDay: number;
  previous: { from: string; to: string; total: number };
  byCategory: CategoryTotal[];
  byDay: Required<DayTotal>[];
  topItems: { item: string; category: string; total: number; count: number }[];
  trips: TripRow[];
};
export type Expense = {
  id: number;
  spent_on: string;
  item: string;
  category: string;
  amount: number;
  place: string | null;
  city: string | null;
  trip_id: number | null;
  trip_city?: string | null;
};
export type Meta = {
  categories: string[];
  cities: string[];
  today: string;
  first: string | null;
  last: string | null;
  period: Period;
  previousPeriod: Period | null;
};

export type JarKey = 'bat_buoc' | 'tieu_xai' | 'game' | 'tiet_kiem';
export type JarStatus = { key: JarKey; name: string; emoji: string; budget: number; spent: number };
export type MonthStatus = {
  month: string;
  period: Period;
  pending: { id: number; amount: number; note: string | null }[];
  income: number;
  incomes: { id: number; amount: number; note: string | null }[];
  spent: number;
  saved: number | null;
  jars: JarStatus[];
  byCategory: { category: string; jar: JarKey; total: number }[];
  topItems: { item: string; category: string; total: number }[];
  daysInMonth: number;
  daysPassed: number;
};
export type BudgetData = {
  status: MonthStatus;
  mapping: Record<string, JarKey>;
  jars: { key: JarKey; name: string; emoji: string }[];
  categories: string[];
  periods: { key: string; label: string }[];
};

export type Goal = { id: number; title: string; target: number; saved_before: number; start_month: string; deadline: string; plan_at: number | null };
export type GoalProgress = {
  totalMonths: number;
  monthsLeft: number;
  needPerMonth: number;
  needFromNow: number;
  saved: number;
  percent: number;
  months: { month: string; income: number; spent: number; saved: number | null }[];
  missingIncome: string[];
};
export type GoalPlan = {
  summary: string;
  budgets: { category: string; jar: JarKey; current: number; target: number; action: 'giữ' | 'giảm' | 'cắt'; reason: string }[];
  tips: string[];
  income: number;
  need: number;
  currentSpend: number;
  plannedSpend: number;
  plannedSaving: number;
  dataDays: number;
  source: 'ai' | 'rule';
};
export type GoalView = { goal: Goal | null; progress?: GoalProgress; plan?: GoalPlan | null; planError?: string | null };

export type Recurring = {
  id: number;
  item: string;
  amount: number;
  category: string;
  day: number;
  active: number;
  start_month: string;
  last_month: string | null;
};

export type CreditCharge = { id: number; amount: number; item: string; category: string; spent_on: string; settled: number; provider: string };

export type Period = { key: string; kind: 'cycle' | 'month'; from: string; to: string; open: boolean; label: string };
export type ForecastLine = { label: string; amount: number; day?: string; expected?: boolean };
export type ForecastPeriod = { label: string; from: string; to: string; lines: ForecastLine[]; end: number };
export type PendingIncome = { id: number; month: string; amount: number; note: string | null; created_at: number };
export type Forecast = {
  balance: { snapshot: { id: number; amount: number; day: string; created_at: number }; incomeSince: number; spentSince: number; now: number };
  period: Period;
  payday: number;
  current: ForecastPeriod;
  next: ForecastPeriod;
  pendingSalary: PendingIncome[];
  salaryDue: { amount: number } | null;
};
export type SalaryState = { pending: PendingIncome[]; due: { amount: number } | null; period: Period; average: number };

export type DashboardData = {
  today: string;
  status: MonthStatus;
  forecast: Forecast | null;
  goal: (Omit<GoalProgress, 'months'> & { title: string; target: number; deadline: string }) | null;
  credit: { total: number; count: number; billedMonth: string; byProvider: { key: string; name: string; total: number }[] } | null;
  upcoming: { id: number; item: string; amount: number; category: string; day: number }[];
  fixedTotal: number;
  history: { month: string; income: number; spent: number; saved: number | null }[];
};

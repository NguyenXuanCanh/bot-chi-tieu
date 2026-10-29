import { BookUser, Coins, Ellipsis, LayoutDashboard, LogOut, Plane, ReceiptText, Settings as SettingsIcon, Target, Wallet } from 'lucide-react';
import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { Button, Card, cx, ErrorBox, Field, Input, Spinner, ToastProvider } from './components/ui';
import { api, getToken, setToken } from './lib/api';

// Mỗi trang một file riêng (thư viện biểu đồ khá nặng) — trang đăng nhập mở nhanh hơn.
const OverviewPage = lazy(() => import('./pages/Overview'));
const ExpensesPage = lazy(() => import('./pages/Expenses'));
const TripsPage = lazy(() => import('./pages/Trips'));
const TripDetailPage = lazy(() => import('./pages/TripDetail'));
const BudgetPage = lazy(() => import('./pages/Budget'));
const GoalPage = lazy(() => import('./pages/Goal'));
const DebtsPage = lazy(() => import('./pages/Debts'));
const SettingsPage = lazy(() => import('./pages/Settings'));

const NAV = [
  { to: '/', label: 'Tổng quan', icon: LayoutDashboard, end: true },
  { to: '/expenses', label: 'Chi tiêu', icon: ReceiptText },
  { to: '/budget', label: 'Ngân sách', icon: Coins },
  { to: '/debts', label: 'Sổ nợ', icon: BookUser },
  { to: '/goal', label: 'Mục tiêu', icon: Target },
  { to: '/trips', label: 'Chuyến đi', icon: Plane },
  { to: '/settings', label: 'Cài đặt', icon: SettingsIcon },
];

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  useEffect(() => {
    const out = () => setAuthed(false);
    window.addEventListener('admin-logout', out);
    return () => window.removeEventListener('admin-logout', out);
  }, []);

  return (
    <ToastProvider>
      {authed ? (
        <BrowserRouter>
          <Shell
            onLogout={() => {
              setToken(null);
              setAuthed(false);
            }}
          />
        </BrowserRouter>
      ) : (
        <Login onDone={() => setAuthed(true)} />
      )}
    </ToastProvider>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="min-h-dvh md:flex">
      {/* Thanh bên (máy tính) */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-card p-4 md:flex">
        <Brand />
        <nav className="mt-6 flex flex-1 flex-col gap-1" aria-label="Điều hướng">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx(
                  'flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150',
                  isActive ? 'bg-primary text-white' : 'text-foreground hover:bg-muted',
                )
              }>
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <AccountBadge />
        <Button variant="ghost" onClick={onLogout} className="justify-start">
          <LogOut className="size-4" aria-hidden /> Đăng xuất
        </Button>
      </aside>

      <main className="min-w-0 flex-1 px-4 pb-24 pt-4 md:px-8 md:pb-10 md:pt-8">
        <div className="mb-4 md:hidden">
          <Brand />
        </div>
        <div className="mx-auto max-w-6xl">
          <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/budget" element={<BudgetPage />} />
            <Route path="/goal" element={<GoalPage />} />
            <Route path="/debts" element={<DebtsPage />} />
            <Route path="/trips" element={<TripsPage />} />
            <Route path="/trips/:id" element={<TripDetailPage />} />
            <Route path="/settings" element={<SettingsPage onLogout={onLogout} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </div>
      </main>

      {/* Thanh dưới (điện thoại): 4 trang chính + "Thêm" cho các trang còn lại. */}
      <MobileNav />
    </div>
  );
}

const MOBILE_MAIN = ['/', '/expenses', '/budget', '/debts'];

function MobileNav() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  const more = NAV.filter((n) => !MOBILE_MAIN.includes(n.to));
  const moreActive = more.some((n) => pathname.startsWith(n.to));
  const item = (active: boolean) =>
    cx('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium leading-tight', active ? 'text-primary' : 'text-muted-foreground');
  return (
    <>
      {open ? <button className="fixed inset-0 z-30 bg-slate-900/20 md:hidden" aria-label="Đóng menu" onClick={() => setOpen(false)} /> : null}
      {open ? (
        <div className="fixed inset-x-3 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 rounded-xl border border-border bg-card p-2 shadow-xl md:hidden" role="menu">
          {more.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              role="menuitem"
              className={({ isActive }) => cx('flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium', isActive ? 'bg-primary text-white' : 'hover:bg-muted')}>
              <n.icon className="size-4" aria-hidden />
              {n.label}
            </NavLink>
          ))}
        </div>
      ) : null}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Điều hướng">
        {NAV.filter((n) => MOBILE_MAIN.includes(n.to)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => item(isActive)}>
            <n.icon className="size-5" aria-hidden />
            {n.label}
          </NavLink>
        ))}
        <button onClick={() => setOpen((v) => !v)} className={item(open || moreActive)} aria-expanded={open} aria-haspopup="menu">
          <Ellipsis className="size-5" aria-hidden />
          Thêm
        </button>
      </nav>
    </>
  );
}

/** Tên tài khoản + trạng thái liên kết Telegram ở thanh bên. */
function AccountBadge() {
  const [account, setAccount] = useState<{ username: string; chat_id: number | null } | null>(null);
  useEffect(() => {
    api<{ username: string; chat_id: number | null }>('/account')
      .then(setAccount)
      .catch(() => undefined);
  }, []);
  if (!account) return null;
  return (
    <NavLink to="/settings" className="mb-2 block rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
      <p className="truncate font-semibold">{account.username}</p>
      <p className={cx('text-xs', account.chat_id ? 'text-success' : 'text-accent')}>
        {account.chat_id ? 'Đã liên kết Telegram' : 'Chưa liên kết Telegram'}
      </p>
    </NavLink>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-lg bg-primary text-white">
        <Wallet className="size-5" aria-hidden />
      </span>
      <div className="leading-tight">
        <p className="font-semibold">Chi Tiêu</p>
        <p className="text-xs text-muted-foreground">Trang quản lý</p>
      </div>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [form, setForm] = useState({ username: '', password: '', confirm: '', invite: '' });
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  useEffect(() => {
    api<{ signupNeedsCode: boolean }>('/config')
      .then((c) => setNeedsCode(c.signupNeedsCode))
      .catch(() => undefined);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (signup && form.password !== form.confirm) return setError('Hai lần nhập mật khẩu không khớp');
    setBusy(true);
    setError('');
    try {
      const { token } = await api<{ token: string }>(signup ? '/signup' : '/login', {
        method: 'POST',
        body: { username: form.username, password: form.password, invite: form.invite },
      });
      setToken(token);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-8">
      <Card className="w-full max-w-sm">
        <div className="mb-5">
          <Brand />
        </div>
        <div className="mb-4 grid grid-cols-2 rounded-lg border border-border bg-background p-1" role="tablist" aria-label="Chọn">
          {(['login', 'signup'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setError('');
              }}
              className={cx('min-h-9 rounded-md text-sm font-medium transition-colors duration-150', mode === m ? 'bg-primary text-white' : 'text-foreground hover:bg-muted')}>
              {m === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Tên đăng nhập" hint={signup ? '3–32 ký tự: chữ không dấu, số, dấu . _ -' : undefined}>
            {(id) => <Input id={id} autoComplete="username" value={form.username} onChange={set('username')} required autoFocus autoCapitalize="none" />}
          </Field>
          <Field label="Mật khẩu" hint={signup ? 'Ít nhất 8 ký tự' : undefined}>
            {(id) => (
              <Input id={id} type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={form.password} onChange={set('password')} required />
            )}
          </Field>
          {signup ? (
            <Field label="Nhập lại mật khẩu">
              {(id) => <Input id={id} type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />}
            </Field>
          ) : null}
          {signup && needsCode ? (
            <Field label="Mã mời" hint="Hỏi chủ trang để lấy mã">
              {(id) => <Input id={id} value={form.invite} onChange={set('invite')} required autoComplete="off" />}
            </Field>
          ) : null}
          {error ? <ErrorBox message={error} /> : null}
          <Button type="submit" loading={busy}>
            {signup ? 'Tạo tài khoản' : 'Đăng nhập'}
          </Button>
          {signup ? <p className="text-xs text-muted-foreground">Tạo xong vào Cài đặt để liên kết Telegram và xem cách dùng bot.</p> : null}
        </form>
      </Card>
    </div>
  );
}

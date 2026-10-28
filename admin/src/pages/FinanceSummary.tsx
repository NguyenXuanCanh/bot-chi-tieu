import { ArrowRight, CalendarClock, CreditCard, PiggyBank, Target, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Card, CardTitle, CategoryBadge, cx, ErrorBox, Spinner } from '../components/ui';
import { api, type DashboardData, type JarStatus } from '../lib/api';
import { JAR_STYLE, monthLabel, vnd, vndShort } from '../lib/format';
import { useApi } from '../lib/use-api';

/** "Bây giờ": số dư, tháng này còn dư, mục tiêu, dư nợ trả sau, các hũ, khoản sắp trừ, 6 tháng gần nhất. Không phụ thuộc kỳ đang chọn. */
export function FinanceSummary() {
  const { data, error, reload } = useApi(() => api<DashboardData>('/dashboard'), 'dashboard');
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const s = data.status;
  const f = data.forecast;
  const jarsSet = s.jars.some((j) => j.budget > 0);
  const pace = s.daysInMonth ? s.daysPassed / s.daysInMonth : 0;

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-4 lg:grid-cols-4">
        <Tile icon={Wallet} label="Tiền đang có" to="/budget">
          {f ? (
            <>
              <Big tone={f.balance.now < 0 ? 'bad' : undefined}>{vnd(f.balance.now)}</Big>
              <Hint>
                Cuối tháng ≈ <b className="num">{vndShort(f.endOfMonth)}</b> · tháng {monthLabel(f.next.month)} ≈ <b className="num">{vndShort(f.next.end)}</b>
              </Hint>
            </>
          ) : (
            <Empty>Nhập số dư để biết cuối tháng còn bao nhiêu</Empty>
          )}
        </Tile>

        <Tile icon={PiggyBank} label={`Tháng ${monthLabel(s.month)} còn dư`} to="/budget">
          {s.saved !== null ? (
            <>
              <Big tone={s.saved < 0 ? 'bad' : 'good'}>{vnd(s.saved)}</Big>
              <Hint>
                Thu {vndShort(s.income)} − chi {vndShort(s.spent)} · {Math.round((s.saved / s.income) * 100)}% lương
              </Hint>
            </>
          ) : (
            <Empty>Chưa nhập lương tháng này (bot: /luong 25tr)</Empty>
          )}
        </Tile>

        <Tile icon={Target} label="Mục tiêu" to="/goal">
          {data.goal ? (
            <>
              <p className="truncate font-semibold">{data.goal.title}</p>
              <div className="mt-1.5 h-2 rounded-full bg-muted" role="progressbar" aria-label="Tiến độ mục tiêu" aria-valuenow={data.goal.percent} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-2 rounded-full bg-success" style={{ width: `${data.goal.percent}%` }} />
              </div>
              <Hint>
                <span className="num">
                  {vndShort(data.goal.saved)} / {vndShort(data.goal.target)}
                </span>{' '}
                · {data.goal.monthsLeft > 0 ? `cần ${vndShort(data.goal.needFromNow)}/tháng` : 'đã tới hạn'}
              </Hint>
            </>
          ) : (
            <Empty>Chưa đặt mục tiêu tiết kiệm</Empty>
          )}
        </Tile>

        <Tile icon={CreditCard} label="Dư nợ trả sau" to="/budget">
          {data.credit ? (
            <>
              <Big>{vnd(data.credit.total)}</Big>
              <Hint>
                {data.credit.count} khoản · trừ vào ngày 1/{monthLabel(data.credit.billedMonth)}
              </Hint>
            </>
          ) : (
            <>
              <Big muted>0 ₫</Big>
              <Hint>Không có dư nợ trả sau</Hint>
            </>
          )}
        </Tile>
      </div>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardTitle extra={<MoreLink to="/budget">Ngân sách</MoreLink>}>
            Các hũ tháng {monthLabel(s.month)} <span className="hidden text-sm font-normal text-muted-foreground sm:inline">· đã qua {s.daysPassed}/{s.daysInMonth} ngày</span>
          </CardTitle>
          {jarsSet ? (
            <ul className="flex flex-col gap-3.5">
              {s.jars.map((j) => (
                <JarBar key={j.key} jar={j} pace={pace} />
              ))}
            </ul>
          ) : (
            <Empty>
              Chưa chia hũ.{' '}
              <Link to="/budget" className="font-medium text-primary hover:underline">
                Chia lương vào hũ
              </Link>
            </Empty>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardTitle extra={data.fixedTotal ? <span className="num text-xs text-muted-foreground">cố định {vndShort(data.fixedTotal)}/tháng</span> : null}>
            <span className="inline-flex items-center gap-2">
              <CalendarClock className="size-4 text-primary" aria-hidden /> Sắp tới
            </span>
          </CardTitle>
          <ul className="flex flex-col divide-y divide-border">
            {data.upcoming.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.item}</p>
                  <CategoryBadge category={r.category} />
                </div>
                <div className="text-right">
                  <p className="num font-semibold">{vndShort(r.amount)}</p>
                  <p className="text-xs text-muted-foreground">ngày {r.day}</p>
                </div>
              </li>
            ))}
            {data.credit ? (
              <li className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">Trả dư nợ trả sau</p>
                  <p className="text-xs text-muted-foreground">{data.credit.byProvider.map((p) => p.name).join(', ')}</p>
                </div>
                <div className="text-right">
                  <p className="num font-semibold">{vndShort(data.credit.total)}</p>
                  <p className="text-xs text-muted-foreground">1/{Number(data.credit.billedMonth.slice(5))}</p>
                </div>
              </li>
            ) : null}
          </ul>
          {!data.upcoming.length && !data.credit ? <Empty>Không có khoản nào sắp trừ trong tháng này.</Empty> : null}
        </Card>
      </div>

      {data.history.length ? <HistoryChart history={data.history} /> : null}
    </>
  );
}

function HistoryChart({ history }: { history: DashboardData['history'] }) {
  const rows = history.map((m) => ({ ...m, label: monthLabel(m.month).replace(/\/\d{2}(\d{2})$/, '/$1') }));
  return (
    <Card>
      <CardTitle>6 tháng gần nhất</CardTitle>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 20, right: 8, left: 0 }} barGap={4}>
            <CartesianGrid stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#475569' }} />
            <YAxis tickFormatter={(v: number) => vndShort(v)} tick={{ fontSize: 12, fill: '#475569' }} width={52} />
            <Tooltip
              formatter={(value, name) => [value === null ? 'chưa nhập lương' : vnd(Number(value)), name]}
              labelFormatter={(_, payload) => (payload?.[0] ? `Tháng ${monthLabel(String(payload[0].payload.month))}` : '')}
              cursor={{ fill: '#e9eef6' }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="income" name="Thu nhập" fill="#047857" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="spent" name="Chi tiêu" fill="#1e40af" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="saved" name="Để dành" fill="#d97706" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="saved" position="top" formatter={(v) => (v === null || v === undefined ? '' : vndShort(Number(v)))} style={{ fontSize: 11, fill: '#1e3a8a' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function JarBar({ jar, pace }: { jar: JarStatus; pace: number }) {
  const { icon: Icon, color } = JAR_STYLE[jar.key];
  const saving = jar.key === 'tiet_kiem';
  const ratio = jar.budget ? jar.spent / jar.budget : 0;
  const over = !saving && jar.budget > 0 && jar.spent > jar.budget;
  const ahead = !saving && !over && jar.budget > 0 && ratio > pace + 0.1;
  return (
    <li>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-2 font-medium">
          <Icon className="size-4" style={{ color }} aria-hidden />
          {jar.name}
          {over ? <span className="rounded bg-red-100 px-1.5 text-xs font-semibold text-red-800">vượt</span> : null}
          {ahead ? <span className="rounded bg-amber-100 px-1.5 text-xs font-semibold text-amber-900">tiêu nhanh</span> : null}
        </span>
        <span className="num text-muted-foreground">
          {saving ? 'dư ' : ''}
          <b className={over ? 'text-destructive' : 'text-foreground'}>{vndShort(jar.spent)}</b> / {jar.budget ? vndShort(jar.budget) : '—'}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-muted" aria-hidden>
        <div className="h-2 rounded-full" style={{ width: `${Math.min(ratio, 1) * 100}%`, background: over ? '#dc2626' : color }} />
        {!saving && jar.budget > 0 && pace > 0 && pace < 1 ? <div className="absolute -top-1 h-4 w-0.5 rounded bg-foreground/50" style={{ left: `${pace * 100}%` }} /> : null}
      </div>
    </li>
  );
}

function Tile({ icon: Icon, label, to, children }: { icon: typeof Wallet; label: string; to: string; children: ReactNode }) {
  return (
    <Link to={to} className="group rounded-xl border border-border bg-card p-4 shadow-sm transition-colors duration-150 hover:border-secondary">
      <p className="mb-1 flex items-center justify-between text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Icon className="size-4 text-primary" aria-hidden /> {label}
        </span>
        <ArrowRight className="size-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100" aria-hidden />
      </p>
      {children}
    </Link>
  );
}

const Big = ({ children, tone, muted }: { children: ReactNode; tone?: 'good' | 'bad'; muted?: boolean }) => (
  <p className={cx('num text-xl font-semibold md:text-2xl', tone === 'good' && 'text-success', tone === 'bad' && 'text-destructive', muted && 'text-muted-foreground')}>
    {children}
  </p>
);
const Hint = ({ children }: { children: ReactNode }) => <p className="mt-1 text-xs text-muted-foreground">{children}</p>;
const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;
const MoreLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="text-sm font-medium text-primary hover:underline">
    {children}
  </Link>
);

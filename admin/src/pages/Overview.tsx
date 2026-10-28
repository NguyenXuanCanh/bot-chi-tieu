import { ArrowDownRight, ArrowUpRight, Plane } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Card, CardTitle, CategoryBadge, cx, EmptyState, ErrorBox, Spinner } from '../components/ui';
import { api, type Meta, type Summary } from '../lib/api';
import { addDays, changePercent, dayLabel, dayRange, styleOf, todayVn, vnd, vndShort } from '../lib/format';
import { useApi } from '../lib/use-api';
import { AskCard } from './AskCard';
import { FinanceSummary } from './FinanceSummary';
import { SalaryBanner } from './SalaryBanner';

type Preset = 'month' | 'lastMonth' | '7d' | '30d';
const PRESETS: { value: Preset; label: string }[] = [
  { value: 'month', label: 'Tháng này' },
  { value: 'lastMonth', label: 'Tháng trước' },
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' },
];

/** "Kỳ này / Kỳ trước" theo kỳ lương (từ lần nhận lương) nếu có, không thì theo tháng lịch. */
function rangeOf(preset: Preset, meta?: Meta) {
  const today = todayVn();
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case 'lastMonth': {
      if (meta?.period.kind === 'cycle' && meta.previousPeriod) return { from: meta.previousPeriod.from, to: meta.previousPeriod.to };
      const lastEnd = addDays(monthStart, -1);
      return { from: `${lastEnd.slice(0, 7)}-01`, to: lastEnd };
    }
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    default:
      return meta?.period.kind === 'cycle' ? { from: meta.period.from, to: today } : { from: monthStart, to: today };
  }
}

export default function OverviewPage() {
  const [preset, setPreset] = useState<Preset>('month');
  const meta = useApi(() => api<Meta>('/meta'), 'meta');
  const cycle = meta.data?.period.kind === 'cycle';
  const range = rangeOf(preset, meta.data);
  const [version, setVersion] = useState(0);
  const { data, error, loading, reload } = useApi(() => api<Summary>('/summary', { query: range }), `${range.from}|${range.to}`);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Tổng quan</h1>
        <p className="text-sm text-muted-foreground">Tình hình tiền bạc hiện tại và chi tiêu theo kỳ</p>
      </header>

      <SalaryBanner onReceived={() => setVersion((v) => v + 1)} />
      <FinanceSummary key={version} />

      <AskCard />

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3 border-t border-border pt-5">
        <div>
          <h2 className="text-lg font-semibold">Chi tiêu theo kỳ</h2>
          <p className="text-sm text-muted-foreground">{dayRange(range.from, range.to)}</p>
        </div>
        <div className="flex rounded-lg border border-border bg-card p-1" role="group" aria-label="Chọn kỳ">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              aria-pressed={preset === p.value}
              className={cx(
                'min-h-9 rounded-md px-3 text-sm font-medium transition-colors duration-150',
                preset === p.value ? 'bg-primary text-white' : 'text-foreground hover:bg-muted',
              )}>
              {cycle && p.value === 'month' ? 'Kỳ này' : cycle && p.value === 'lastMonth' ? 'Kỳ trước' : p.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <ErrorBox message={error} onRetry={reload} /> : null}
      {!data && loading ? <Spinner /> : null}
      {data ? <Dashboard data={data} /> : null}
    </div>
  );
}

function Dashboard({ data }: { data: Summary }) {
  if (data.count === 0) {
    return (
      <Card>
        <EmptyState title="Chưa có khoản chi nào trong kỳ này" desc="Nhắn cho bot Telegram như “phở 45k” để bắt đầu ghi." />
      </Card>
    );
  }
  const change = changePercent(data.total, data.previous.total);
  const travelShare = data.total ? Math.round((data.travel / data.total) * 100) : 0;
  const categories = data.byCategory.map((c) => ({ ...c, fill: styleOf(c.category).color }));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <Stat label="Tổng chi" value={vnd(data.total)} hint={`${data.count} khoản`} />
        <Stat label="Trung bình / ngày" value={vnd(data.perDay)} hint={`${data.days} ngày`} />
        <Stat
          label="So với kỳ trước"
          value={change === null ? '—' : `${change > 0 ? '+' : ''}${change}%`}
          hint={`Kỳ trước: ${vndShort(data.previous.total)}`}
          trend={change === null ? undefined : change > 0 ? 'up' : 'down'}
        />
        <Stat label="Du lịch" value={vnd(data.travel)} hint={`${travelShare}% tổng chi`} />
      </div>

      <Card>
        <CardTitle>Chi theo ngày</CardTitle>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.byDay.map((d) => ({ ...d, normal: d.total - d.travel }))} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="day" tickFormatter={(d: string) => dayLabel(d)} tick={{ fontSize: 12, fill: '#475569' }} minTickGap={16} />
              <YAxis tickFormatter={(v: number) => vndShort(v)} tick={{ fontSize: 12, fill: '#475569' }} width={52} />
              <Tooltip
                formatter={(value, name) => [vnd(Number(value)), name === 'travel' ? 'Du lịch' : 'Thường ngày']}
                labelFormatter={(d) => dayLabel(String(d), true)}
              />
              <Area type="monotone" dataKey="normal" stackId="1" stroke="#1e40af" fill="#1e40af" fillOpacity={0.2} name="normal" />
              <Area type="monotone" dataKey="travel" stackId="1" stroke="#d97706" fill="#d97706" fillOpacity={0.25} name="travel" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
          <Legend color="#1e40af" label="Thường ngày" />
          <Legend color="#d97706" label="Du lịch" />
        </div>
      </Card>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardTitle>Theo danh mục</CardTitle>
          <div style={{ height: Math.max(160, categories.length * 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categories} layout="vertical" margin={{ left: 8, right: 56 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="category" width={150} tick={{ fontSize: 13, fill: '#1e3a8a' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => vnd(Number(value))} cursor={{ fill: '#e9eef6' }} />
                <Bar dataKey="total" radius={[0, 4, 4, 0]} barSize={22} isAnimationActive={false}>
                  <LabelList dataKey="total" position="right" formatter={(v) => vndShort(Number(v))} style={{ fontSize: 12, fill: '#1e3a8a' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardTitle>Chi nhiều nhất</CardTitle>
          <ul className="flex flex-col divide-y divide-border">
            {data.topItems.map((t) => (
              <li key={t.item} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.item}</p>
                  <CategoryBadge category={t.category} />
                </div>
                <div className="text-right">
                  <p className="num font-semibold">{vndShort(t.total)}</p>
                  <p className="text-xs text-muted-foreground">{t.count} lần</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {data.trips.length ? (
        <Card>
          <CardTitle extra={<Link to="/trips" className="text-sm font-medium text-primary hover:underline">Tất cả</Link>}>
            Chuyến đi trong kỳ
          </CardTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.trips.map((t) => (
              <Link
                key={t.id}
                to={`/trips/${t.id}`}
                className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors duration-150 hover:bg-muted">
                <span className="grid size-10 place-items-center rounded-lg bg-amber-50 text-accent">
                  <Plane className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{t.city}</p>
                  <p className="text-sm text-muted-foreground">{dayRange(t.started_on, t.ended_on)}</p>
                </div>
                <p className="num font-semibold">{vndShort(t.total)}</p>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}
    </>
  );
}

function Stat({ label, value, hint, trend }: { label: string; value: string; hint?: string; trend?: 'up' | 'down' }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={cx(
          'num mt-1 flex items-center gap-1 text-xl font-semibold md:text-2xl',
          trend === 'up' && 'text-destructive',
          trend === 'down' && 'text-success',
        )}>
        {trend === 'up' ? <ArrowUpRight className="size-5" aria-label="tăng" /> : null}
        {trend === 'down' ? <ArrowDownRight className="size-5" aria-label="giảm" /> : null}
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

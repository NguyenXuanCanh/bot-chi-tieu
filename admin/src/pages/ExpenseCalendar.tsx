import { ChevronLeft, ChevronRight, Pencil, Plane } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Card, CardTitle, CategoryBadge, cx, ErrorBox, Spinner } from '../components/ui';
import { api, type Expense, type Summary } from '../lib/api';
import { addMonths, dayLabel, monthLabel, todayVn, vnd, vndShort } from '../lib/format';
import { useApi } from '../lib/use-api';

/**
 * Dải màu tuần tự một sắc xanh (nhạt = ít, đậm = nhiều), đã kiểm tra bằng validate_palette của skill dataviz:
 * các bậc liền kề cách nhau ΔE ≥ 17 (kể cả mù màu). Hai bậc nhạt tương phản thấp với nền nên ô nào cũng in số tiền.
 */
const STEPS = [
  { bg: '#bfdbfe', ink: '#1e3a8a' },
  { bg: '#60a5fa', ink: '#0f172a' },
  { bg: '#2563eb', ink: '#ffffff' },
  { bg: '#1e3a8a', ink: '#ffffff' },
];
const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/** Ngưỡng bậc màu theo tứ phân vị các ngày có chi (ngày đóng tiền nhà không làm mọi ngày khác nhạt hết). */
function thresholds(values: number[]) {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [0, 0, 0];
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return [q(0.25), q(0.5), q(0.75)];
}
/** Số gọn cho ô lịch trên điện thoại: 4.820.000 -> "4,8tr", 250.000 -> "250k". */
const compact = (v: number) => (v >= 1_000_000 ? `${String(Math.round(v / 100_000) / 10).replace('.', ',')}tr` : `${Math.round(v / 1000)}k`);
const stepOf = (value: number, t: number[]) => (value <= t[0] ? 0 : value <= t[1] ? 1 : value <= t[2] ? 2 : 3);

export function ExpenseCalendar({ version, onEdit }: { version: number; onEdit: (e: Expense) => void }) {
  const today = todayVn();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(today);
  const from = `${month}-01`;
  const to = `${month}-${String(daysIn(month)).padStart(2, '0')}`;
  const data = useApi(() => api<Summary>('/summary', { query: { from, to } }), `cal-${month}-${version}`);

  useEffect(() => setSelected(month === today.slice(0, 7) ? today : null), [month, today]);

  const days = data.data?.byDay ?? [];
  const t = thresholds(days.map((d) => d.total));
  const spentDays = days.filter((d) => d.total > 0 && d.day <= today);
  const passed = days.filter((d) => d.day <= today).length;
  const top = [...spentDays].sort((a, b) => b.total - a.total)[0];
  // Ô trống trước ngày 1 để ngày 1 rơi đúng thứ (tuần bắt đầu thứ Hai).
  const lead = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            <button className="rounded-md p-2 hover:bg-muted" onClick={() => setMonth(addMonths(month, -1))} aria-label="Tháng trước">
              <ChevronLeft className="size-4" />
            </button>
            <span className="num min-w-24 text-center text-sm font-semibold">Tháng {monthLabel(month)}</span>
            <button
              className="rounded-md p-2 hover:bg-muted disabled:opacity-40"
              onClick={() => setMonth(addMonths(month, 1))}
              disabled={month >= today.slice(0, 7)}
              aria-label="Tháng sau">
              <ChevronRight className="size-4" />
            </button>
          </div>
          {data.data ? (
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <div>
                <dt className="inline text-muted-foreground">Tổng: </dt>
                <dd className="num inline font-semibold">{vnd(data.data.total)}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Ngày không chi: </dt>
                <dd className="num inline font-semibold">
                  {passed - spentDays.length}/{passed}
                </dd>
              </div>
              {top ? (
                <div>
                  <dt className="inline text-muted-foreground">Nhiều nhất: </dt>
                  <dd className="num inline font-semibold">
                    {dayLabel(top.day)} · {vndShort(top.total)}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>

        {data.error ? <ErrorBox message={data.error} onRetry={data.reload} /> : null}
        {!data.data && data.loading ? <Spinner /> : null}
        {data.data ? (
          <>
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5" role="grid" aria-label={`Chi tiêu tháng ${monthLabel(month)}`}>
              {WEEKDAYS.map((w) => (
                <div key={w} className="pb-1 text-center text-xs font-medium text-muted-foreground" role="columnheader">
                  {w}
                </div>
              ))}
              {Array.from({ length: lead }, (_, i) => (
                <div key={`e${i}`} aria-hidden />
              ))}
              {days.map((d) => {
                const future = d.day > today;
                const step = d.total > 0 ? STEPS[stepOf(d.total, t)] : null;
                const isSel = selected === d.day;
                return (
                  <button
                    key={d.day}
                    role="gridcell"
                    disabled={future}
                    onClick={() => setSelected(d.day)}
                    title={d.total ? `${dayLabel(d.day)}: ${vnd(d.total)} · ${d.count ?? 0} khoản${d.travel ? ' · có du lịch' : ''}` : `${dayLabel(d.day)}: không chi`}
                    aria-label={`Ngày ${dayLabel(d.day)}: ${d.total ? vnd(d.total) : 'không chi'}`}
                    aria-pressed={isSel}
                    className={cx(
                      'relative flex aspect-square flex-col justify-between rounded-lg p-1 text-left transition-shadow duration-150 sm:aspect-[4/3] sm:p-1.5',
                      !step && 'bg-muted/60',
                      future && 'opacity-40',
                      isSel ? 'ring-2 ring-accent ring-offset-1' : 'hover:ring-2 hover:ring-secondary/50',
                      d.day === today && !isSel && 'ring-1 ring-foreground/40',
                    )}
                    style={step ? { background: step.bg, color: step.ink } : undefined}>
                    <span className="flex items-center justify-between text-[11px] font-semibold leading-none sm:text-xs">
                      {Number(d.day.slice(8))}
                      {d.travel ? <Plane className="size-3" aria-label="du lịch" /> : null}
                    </span>
                    {d.total ? (
                      <span className="num truncate text-[10px] font-semibold leading-none sm:text-xs">
                        <span className="sm:hidden">{compact(d.total)}</span>
                        <span className="hidden sm:inline">{vndShort(d.total)}</span>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <Legend t={t} />
          </>
        ) : null}
      </Card>

      {selected ? <DayList day={selected} version={version} onEdit={onEdit} /> : null}
    </div>
  );
}

function Legend({ t }: { t: number[] }) {
  if (!t[2]) return null;
  const labels = [`≤ ${vndShort(t[0])}`, `≤ ${vndShort(t[1])}`, `≤ ${vndShort(t[2])}`, `> ${vndShort(t[2])}`];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Chú thích màu">
      <span>Ít</span>
      {STEPS.map((s, i) => (
        <span key={s.bg} className="inline-flex items-center gap-1">
          <span className="size-3 rounded-sm" style={{ background: s.bg }} aria-hidden />
          <span className="num">{labels[i]}</span>
        </span>
      ))}
      <span>Nhiều</span>
    </div>
  );
}

function DayList({ day, version, onEdit }: { day: string; version: number; onEdit: (e: Expense) => void }) {
  const list = useApi(() => api<{ rows: Expense[]; sum: number }>('/expenses', { query: { from: day, to: day, pageSize: 100 } }), `day-${day}-${version}`);
  return (
    <Card className="p-0">
      <div className="px-4 pt-4 md:px-5">
        <CardTitle extra={list.data ? <span className="num text-sm font-semibold">{vnd(list.data.sum)}</span> : null}>Ngày {dayLabel(day, true)}</CardTitle>
      </div>
      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
      {!list.data && list.loading ? <Spinner /> : null}
      {list.data && list.data.rows.length === 0 ? <p className="px-4 pb-4 text-sm text-muted-foreground md:px-5">Không có khoản chi nào.</p> : null}
      {list.data?.rows.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {list.data.rows.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-5">
              <div className="min-w-0">
                <p className="truncate font-medium">{e.item}</p>
                <CategoryBadge category={e.category} />
              </div>
              <div className="flex items-center gap-1">
                <span className="num mr-1 font-semibold">{vndShort(e.amount)}</span>
                <button onClick={() => onEdit(e)} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Sửa ${e.item}`}>
                  <Pencil className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

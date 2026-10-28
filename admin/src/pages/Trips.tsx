import { ChevronRight, Plane } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Card, EmptyState, ErrorBox, Spinner } from '../components/ui';
import { api, type TripRow } from '../lib/api';
import { daysBetween, dayRange, vnd, vndShort } from '../lib/format';
import { useApi } from '../lib/use-api';

export default function TripsPage() {
  const { data, error, loading, reload } = useApi(() => api<{ rows: TripRow[] }>('/trips'), 'trips');
  const totalAll = data?.rows.reduce((s, t) => s + t.total, 0) ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Chuyến đi</h1>
        {data?.rows.length ? (
          <p className="text-sm text-muted-foreground">
            {data.rows.length} chuyến · tổng <span className="num font-semibold text-foreground">{vnd(totalAll)}</span>
          </p>
        ) : null}
      </header>
      {error ? <ErrorBox message={error} onRetry={reload} /> : null}
      {!data && loading ? <Spinner /> : null}
      {data && data.rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Chưa có chuyến đi nào"
            desc="Ghi chi tiêu kèm nơi chốn cho bot (“bánh căn 60k ở Đà Lạt”) hoặc gõ /dulich Đà Lạt, chuyến đi sẽ tự hiện ở đây."
          />
        </Card>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {data?.rows.map((t) => {
          const days = daysBetween(t.started_on, t.ended_on) + 1;
          return (
            <Link key={t.id} to={`/trips/${t.id}`} className="group">
              <Card className="flex items-center gap-4 transition-colors duration-150 group-hover:border-primary">
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-amber-50 text-accent">
                  <Plane className="size-6" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-lg font-semibold">
                    {t.city}
                    {t.active ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Đang đi</span> : null}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {dayRange(t.started_on, t.ended_on)} · {days} ngày · {t.count} khoản
                  </p>
                </div>
                <div className="text-right">
                  <p className="num text-lg font-semibold">{vndShort(t.total)}</p>
                  <p className="text-xs text-muted-foreground">{vndShort(t.total / days)}/ngày</p>
                </div>
                <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

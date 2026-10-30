import { CalendarDays, ChevronLeft, ChevronRight, CreditCard, List, Pencil, Plane, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Button, Card, CategoryBadge, cx, EmptyState, ErrorBox, Field, Input, Modal, Select, Spinner, useToast } from '../components/ui';
import { api, type Expense, type Meta, type TripRow } from '../lib/api';
import { addMonths, dayLabel, monthLabel, PAYLATER, vnd } from '../lib/format';
import { useApi } from '../lib/use-api';
import { ExpenseCalendar } from './ExpenseCalendar';
import { ExpenseForm } from './ExpenseForm';

type Filters = { from: string; to: string; category: string; city: string; trip: string; q: string; sort: string; page: number };
const EMPTY: Filters = { from: '', to: '', category: '', city: '', trip: '', q: '', sort: 'day', page: 1 };

export default function ExpensesPage() {
  const toast = useToast();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [crediting, setCrediting] = useState<Expense | null>(null);
  const [busy, setBusy] = useState(false);
  // ?view=calendar = xem dạng lịch; ?new=1 = mở luôn form thêm (lối tắt khi nhấn giữ icon app).
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'calendar' ? 'calendar' : 'list';
  const [version, setVersion] = useState(0);

  const meta = useApi(() => api<Meta>('/meta'), 'meta');
  useEffect(() => {
    if (params.get('new') && meta.data) {
      setEditing('new');
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, meta.data, setParams]);
  const setView = (v: 'list' | 'calendar') => {
    if (v === 'calendar') params.set('view', 'calendar');
    else params.delete('view');
    setParams(params, { replace: true });
  };
  const trips = useApi(() => api<{ rows: TripRow[] }>('/trips'), 'trips');
  const list = useApi(
    () => api<{ rows: Expense[]; total: number; sum: number; page: number; pageSize: number }>('/expenses', { query: filters }),
    JSON.stringify(filters),
  );
  const change = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch, page: patch.page ?? 1 });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/expenses/${deleting.id}`, { method: 'DELETE' });
      toast(`Đã xóa “${deleting.item}”`);
      setDeleting(null);
      list.reload();
      setVersion((v) => v + 1);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Chi tiêu</h1>
          {list.data ? (
            <p className="text-sm text-muted-foreground">
              {list.data.total} khoản · tổng <span className="num font-semibold text-foreground">{vnd(list.data.sum)}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-card p-1" role="group" aria-label="Cách xem">
            {(
              [
                ['list', 'Danh sách', List],
                ['calendar', 'Lịch', CalendarDays],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={cx(
                  'inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-150',
                  view === v ? 'bg-primary text-white' : 'text-foreground hover:bg-muted',
                )}>
                <Icon className="size-4" aria-hidden /> {label}
              </button>
            ))}
          </div>
          <Button onClick={() => setEditing('new')} disabled={!meta.data}>
            <Plus className="size-4" aria-hidden /> Thêm khoản chi
          </Button>
        </div>
      </header>

      {view === 'calendar' ? (
        <ExpenseCalendar version={version} onEdit={setEditing} />
      ) : (
        <>
          <Card className="p-3 md:p-4">
            <form
              className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5"
              onSubmit={(e) => {
                e.preventDefault();
                change({ q: search.trim() });
              }}>
              <div className="col-span-2 md:col-span-3 lg:col-span-5">
                <Field label="Tìm theo tên">
                  {(id) => (
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                      <Input id={id} value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => change({ q: search.trim() })} className="pl-9" placeholder="phở, grab…" />
                    </div>
                  )}
                </Field>
              </div>
              <Field label="Từ ngày">{(id) => <Input id={id} type="date" value={filters.from} onChange={(e) => change({ from: e.target.value })} />}</Field>
              <Field label="Đến ngày">{(id) => <Input id={id} type="date" value={filters.to} onChange={(e) => change({ to: e.target.value })} />}</Field>
              <Field label="Danh mục">
                {(id) => (
                  <Select id={id} value={filters.category} onChange={(e) => change({ category: e.target.value })}>
                    <option value="">Tất cả</option>
                    {meta.data?.categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Du lịch">
                {(id) => (
                  <Select id={id} value={filters.trip} onChange={(e) => change({ trip: e.target.value })}>
                    <option value="">Tất cả</option>
                    <option value="any">Chỉ du lịch</option>
                    <option value="none">Không du lịch</option>
                    {trips.data?.rows.map((t) => (
                      <option key={t.id} value={t.id}>
                        Chuyến {t.city}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Sắp xếp">
                {(id) => (
                  <Select id={id} value={filters.sort} onChange={(e) => change({ sort: e.target.value })}>
                    <option value="day">Mới nhất</option>
                    <option value="day_asc">Cũ nhất</option>
                    <option value="amount">Tiền nhiều nhất</option>
                    <option value="amount_asc">Tiền ít nhất</option>
                  </Select>
                )}
              </Field>
            </form>
          </Card>

          {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
          {!list.data && list.loading ? <Spinner /> : null}

          {list.data ? (
            <Card className="p-0">
              {list.data.rows.length === 0 ? (
                <EmptyState title="Không có khoản chi nào" desc="Thử bỏ bớt bộ lọc." />
              ) : (
                <>
                  {/* Bảng (máy tính) */}
                  <table className="hidden w-full text-sm md:table">
                    <thead className="border-b border-border text-left text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Ngày</th>
                        <th className="px-4 py-3 font-medium">Khoản chi</th>
                        <th className="px-4 py-3 font-medium">Danh mục</th>
                        <th className="px-4 py-3 font-medium">Nơi / chuyến</th>
                        <th className="px-4 py-3 text-right font-medium">Số tiền</th>
                        <th className="w-32 px-4 py-3" aria-label="Thao tác" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {list.data.rows.map((e) => (
                        <tr key={e.id} className="hover:bg-background">
                          <td className="num px-4 py-2.5 text-muted-foreground">{dayLabel(e.spent_on)}</td>
                          <td className="px-4 py-2.5 font-medium">{e.item}</td>
                          <td className="px-4 py-2.5">
                            <CategoryBadge category={e.category} />
                          </td>
                          <td className="px-4 py-2.5">
                            <Where e={e} />
                          </td>
                          <td className="num px-4 py-2.5 text-right font-semibold">{vnd(e.amount)}</td>
                          <td className="px-4 py-2.5">
                            <RowActions onEdit={() => setEditing(e)} onDelete={() => setDeleting(e)} onCredit={() => setCrediting(e)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Thẻ (điện thoại) */}
                  <ul className="divide-y divide-border md:hidden">
                    {list.data.rows.map((e) => (
                      <li key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="font-medium">{e.item}</p>
                          <CategoryBadge category={e.category} />
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {dayLabel(e.spent_on)} <Where e={e} />
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <p className="num font-semibold">{vnd(e.amount)}</p>
                          <RowActions onEdit={() => setEditing(e)} onDelete={() => setDeleting(e)} onCredit={() => setCrediting(e)} />
                        </div>
                      </li>
                    ))}
                  </ul>

                  <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
                    <span className="text-muted-foreground">
                      Trang {filters.page}/{pages}
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" disabled={filters.page <= 1} onClick={() => change({ page: filters.page - 1 })} aria-label="Trang trước">
                        <ChevronLeft className="size-4" />
                      </Button>
                      <Button variant="outline" disabled={filters.page >= pages} onClick={() => change({ page: filters.page + 1 })} aria-label="Trang sau">
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Card>
          ) : null}

        </>
      )}

      <Modal open={editing !== null} title={editing === 'new' ? 'Thêm khoản chi' : 'Sửa khoản chi'} onClose={() => setEditing(null)}>
        {meta.data ? (
          <ExpenseForm
            expense={editing && editing !== 'new' ? editing : undefined}
            meta={meta.data}
            trips={trips.data?.rows ?? []}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              toast(editing === 'new' ? 'Đã thêm khoản chi' : 'Đã lưu thay đổi');
              setEditing(null);
              list.reload();
              trips.reload();
              setVersion((v) => v + 1);
            }}
          />
        ) : null}
      </Modal>

      <Modal open={crediting !== null} title="Chuyển sang trả sau" onClose={() => setCrediting(null)}>
        {crediting ? (
          <ToCreditForm
            expense={crediting}
            onCancel={() => setCrediting(null)}
            onDone={() => {
              toast(`Đã chuyển “${crediting.item}” sang dư nợ trả sau`);
              setCrediting(null);
              list.reload();
              setVersion((v) => v + 1);
            }}
          />
        ) : null}
      </Modal>

      <Modal open={deleting !== null} title="Xóa khoản chi?" onClose={() => setDeleting(null)}>
        <p>
          Xóa <b>{deleting?.item}</b> ({deleting ? vnd(deleting.amount) : ''}, ngày {deleting ? dayLabel(deleting.spent_on) : ''})? Không hoàn tác được.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleting(null)}>
            Hủy
          </Button>
          <Button variant="danger" loading={busy} onClick={remove}>
            Xóa
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Where({ e }: { e: Expense }) {
  if (e.trip_id) {
    return (
      <span className="inline-flex items-center gap-1 text-accent">
        <Plane className="size-3.5" aria-hidden />
        {e.trip_city ?? e.city}
      </span>
    );
  }
  return <span className="text-muted-foreground">{e.city ?? '—'}</span>;
}

function RowActions({ onEdit, onDelete, onCredit }: { onEdit: () => void; onDelete: () => void; onCredit: () => void }) {
  return (
    <div className="flex justify-end gap-1">
      <button onClick={onCredit} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Chuyển sang trả sau" title="Thực ra trả bằng thẻ / ví trả sau">
        <CreditCard className="size-4" />
      </button>
      <button onClick={onEdit} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Sửa">
        <Pencil className="size-4" />
      </button>
      <button onClick={onDelete} className="rounded-md p-2 text-muted-foreground hover:bg-red-50 hover:text-destructive" aria-label="Xóa">
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

/** Khoản chi thực ra trả bằng thẻ / ví trả sau: rút khỏi chi tiêu kỳ này, trừ vào ngày 1 tháng sau tháng mua. */
function ToCreditForm({ expense, onCancel, onDone }: { expense: Expense; onCancel: () => void; onDone: () => void }) {
  const [provider, setProvider] = useState('card');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const next = addMonths(expense.spent_on.slice(0, 7), 1);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/expenses/${expense.id}/to-credit`, { method: 'POST', body: { provider } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm">
        <b>{expense.item}</b> · {vnd(expense.amount)} · ngày {dayLabel(expense.spent_on)}
      </p>
      <Field label="Thực ra đã trả qua">
        {(id) => (
          <Select id={id} value={provider} onChange={(e) => setProvider(e.target.value)}>
            {PAYLATER.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <p className="rounded-lg bg-muted px-3 py-2 text-sm">
        Khoản này sẽ không tính vào chi tiêu kỳ hiện tại nữa, mà vào dư nợ trả sau và thành chi tiêu ngày <b>1/{monthLabel(next)}</b>.
        Giữ nguyên danh mục và chuyến đi.
      </p>
      {error ? <ErrorBox message={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Hủy
        </Button>
        <Button type="submit" loading={busy}>
          Chuyển
        </Button>
      </div>
    </form>
  );
}

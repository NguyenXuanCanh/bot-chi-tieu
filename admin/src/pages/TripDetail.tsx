import { ArrowLeft, Merge, Pencil, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Button, Card, CardTitle, CategoryBadge, ErrorBox, Field, Input, Modal, Select, Spinner, useToast } from '../components/ui';
import { api, type CategoryTotal, type DayTotal, type Expense, type TripRow } from '../lib/api';
import { daysBetween, dayLabel, dayRange, styleOf, vnd, vndShort } from '../lib/format';
import { useApi } from '../lib/use-api';

type Detail = {
  trip: TripRow;
  total: number;
  byCategory: CategoryTotal[];
  byDay: DayTotal[];
  expenses: Expense[];
};

export default function TripDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const detail = useApi(() => api<Detail>(`/trips/${id}`), `trip-${id}`);
  const trips = useApi(() => api<{ rows: TripRow[] }>('/trips'), 'trips');
  const [modal, setModal] = useState<'edit' | 'merge' | 'delete' | null>(null);

  if (detail.error) return <ErrorBox message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <Spinner />;
  const { trip, total, byCategory, byDay, expenses } = detail.data;
  const days = daysBetween(trip.started_on, trip.ended_on) + 1;

  const done = (message: string, goBack = false) => {
    toast(message);
    setModal(null);
    if (goBack) navigate('/trips');
    else detail.reload();
    trips.reload();
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <Link to="/trips" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Các chuyến đi
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{trip.city}</h1>
          <p className="text-sm text-muted-foreground">
            {dayRange(trip.started_on, trip.ended_on)} · {days} ngày
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setModal('edit')}>
            <Pencil className="size-4" aria-hidden /> Sửa
          </Button>
          <Button variant="outline" onClick={() => setModal('merge')} disabled={(trips.data?.rows.length ?? 0) < 2}>
            <Merge className="size-4" aria-hidden /> Gộp
          </Button>
          <Button variant="outline" onClick={() => setModal('delete')} className="text-destructive">
            <Trash2 className="size-4" aria-hidden /> Xóa
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3 md:gap-4">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Tổng chi</p>
          <p className="num mt-1 text-xl font-semibold md:text-2xl">{vnd(total)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Mỗi ngày</p>
          <p className="num mt-1 text-xl font-semibold md:text-2xl">{vndShort(total / days)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Số khoản</p>
          <p className="num mt-1 text-xl font-semibold md:text-2xl">{expenses.length}</p>
        </Card>
      </div>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Theo ngày</CardTitle>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byDay} margin={{ top: 20, right: 8 }}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="day" tickFormatter={(d: string) => dayLabel(d)} tick={{ fontSize: 12, fill: '#475569' }} />
                <YAxis tickFormatter={(v: number) => vndShort(v)} tick={{ fontSize: 12, fill: '#475569' }} width={52} />
                <Tooltip formatter={(v) => vnd(Number(v))} labelFormatter={(d) => dayLabel(String(d), true)} cursor={{ fill: '#e9eef6' }} />
                <Bar dataKey="total" fill="#d97706" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  <LabelList dataKey="total" position="top" formatter={(v) => vndShort(Number(v))} style={{ fontSize: 12, fill: '#1e3a8a' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardTitle>Theo danh mục</CardTitle>
          <ul className="flex flex-col gap-3">
            {byCategory.map((c) => (
              <li key={c.category}>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <CategoryBadge category={c.category} />
                  <span className="num font-semibold">{vndShort(c.total)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted" aria-hidden>
                  <div className="h-2 rounded-full" style={{ width: `${(c.total / total) * 100}%`, background: styleOf(c.category).color }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="p-0">
        <div className="px-4 pt-4 md:px-5">
          <CardTitle>Các khoản chi</CardTitle>
        </div>
        <ul className="divide-y divide-border">
          {expenses.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-5">
              <div className="min-w-0">
                <p className="font-medium">{e.item}</p>
                <p className="text-xs text-muted-foreground">
                  {dayLabel(e.spent_on)}
                  {e.place && e.place !== e.city ? ` · ${e.place}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="hidden sm:inline">
                  <CategoryBadge category={e.category} />
                </span>
                <span className="num font-semibold">{vnd(e.amount)}</span>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Modal open={modal === 'edit'} title="Sửa chuyến đi" onClose={() => setModal(null)}>
        <EditTrip trip={trip} onSaved={() => done('Đã lưu chuyến đi')} onCancel={() => setModal(null)} />
      </Modal>
      <Modal open={modal === 'merge'} title={`Gộp chuyến ${trip.city} vào…`} onClose={() => setModal(null)}>
        <MergeTrip
          trip={trip}
          trips={(trips.data?.rows ?? []).filter((t) => t.id !== trip.id)}
          onMerged={(into) => {
            toast('Đã gộp chuyến đi');
            setModal(null);
            navigate(`/trips/${into}`);
            trips.reload();
          }}
          onCancel={() => setModal(null)}
        />
      </Modal>
      <Modal open={modal === 'delete'} title="Xóa chuyến đi?" onClose={() => setModal(null)}>
        <DeleteTrip trip={trip} onDeleted={() => done('Đã xóa chuyến đi', true)} onCancel={() => setModal(null)} />
      </Modal>
    </div>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function EditTrip({ trip, onSaved, onCancel }: { trip: TripRow; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ city: trip.city, started_on: trip.started_on, ended_on: trip.ended_on });
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api(`/trips/${trip.id}`, { method: 'PATCH', body: form });
      onSaved();
    });
  };
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Nơi đến">{(id) => <Input id={id} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required />}</Field>
      </div>
      <Field label="Ngày đi">{(id) => <Input id={id} type="date" value={form.started_on} onChange={(e) => setForm({ ...form, started_on: e.target.value })} required />}</Field>
      <Field label="Ngày về">{(id) => <Input id={id} type="date" value={form.ended_on} onChange={(e) => setForm({ ...form, ended_on: e.target.value })} required />}</Field>
      <p className="text-xs text-muted-foreground sm:col-span-2">Ngày đi/về luôn được nới ra để bao trùm các khoản chi của chuyến.</p>
      {error ? <div className="sm:col-span-2"><ErrorBox message={error} /></div> : null}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="outline" onClick={onCancel}>Hủy</Button>
        <Button type="submit" loading={busy}>Lưu</Button>
      </div>
    </form>
  );
}

function MergeTrip({ trip, trips, onMerged, onCancel }: { trip: TripRow; trips: TripRow[]; onMerged: (into: number) => void; onCancel: () => void }) {
  const [into, setInto] = useState(trips[0] ? String(trips[0].id) : '');
  const { busy, error, run } = useAction();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Mọi khoản chi của chuyến <b className="text-foreground">{trip.city}</b> sẽ chuyển sang chuyến được chọn, rồi chuyến {trip.city} bị xóa. Dùng khi một chuyến đi qua nhiều nơi (VD Đà Lạt → Nha Trang).
      </p>
      <Field label="Gộp vào chuyến">
        {(id) => (
          <Select id={id} value={into} onChange={(e) => setInto(e.target.value)}>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>{t.city} ({dayRange(t.started_on, t.ended_on)})</option>
            ))}
          </Select>
        )}
      </Field>
      {error ? <ErrorBox message={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Hủy</Button>
        <Button
          loading={busy}
          disabled={!into}
          onClick={() =>
            run(async () => {
              await api(`/trips/${trip.id}/merge`, { method: 'POST', body: { into: Number(into) } });
              onMerged(Number(into));
            })
          }>
          Gộp chuyến
        </Button>
      </div>
    </div>
  );
}

function DeleteTrip({ trip, onDeleted, onCancel }: { trip: TripRow; onDeleted: () => void; onCancel: () => void }) {
  const { busy, error, run } = useAction();
  return (
    <div className="flex flex-col gap-4">
      <p>
        Xóa chuyến <b>{trip.city}</b>? Các khoản chi <b>vẫn được giữ</b>, chỉ không còn tính là du lịch.
      </p>
      {error ? <ErrorBox message={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Hủy</Button>
        <Button
          variant="danger"
          loading={busy}
          onClick={() =>
            run(async () => {
              await api(`/trips/${trip.id}`, { method: 'DELETE' });
              onDeleted();
            })
          }>
          Xóa chuyến
        </Button>
      </div>
    </div>
  );
}

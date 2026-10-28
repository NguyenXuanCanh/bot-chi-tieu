import { useState, type FormEvent } from 'react';

import { Button, ErrorBox, Field, Input, Select } from '../components/ui';
import { api, type Expense, type Meta, type TripRow } from '../lib/api';
import { dayRange, todayVn } from '../lib/format';

/** Thêm / sửa một khoản chi. `trips` để chọn chuyến đi (hoặc không thuộc chuyến nào). */
export function ExpenseForm({
  expense,
  meta,
  trips,
  onSaved,
  onCancel,
}: {
  expense?: Expense;
  meta: Meta;
  trips: TripRow[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    item: expense?.item ?? '',
    amount: expense ? String(expense.amount) : '',
    category: expense?.category ?? meta.categories[0],
    spent_on: expense?.spent_on ?? todayVn(),
    city: expense?.city ?? '',
    trip_id: expense?.trip_id ? String(expense.trip_id) : '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = {
        ...form,
        amount: Number(form.amount.replace(/[.,\s]/g, '')),
        trip_id: form.trip_id ? Number(form.trip_id) : null,
      };
      if (expense) await api(`/expenses/${expense.id}`, { method: 'PATCH', body });
      else await api('/expenses', { method: 'POST', body });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Khoản chi">{(id) => <Input id={id} value={form.item} onChange={set('item')} required maxLength={80} />}</Field>
      </div>
      <Field label="Số tiền (₫)" hint="VD: 45000">
        {(id) => <Input id={id} value={form.amount} onChange={set('amount')} inputMode="numeric" required className="num" />}
      </Field>
      <Field label="Ngày">{(id) => <Input id={id} type="date" value={form.spent_on} onChange={set('spent_on')} required />}</Field>
      <Field label="Danh mục">
        {(id) => (
          <Select id={id} value={form.category} onChange={set('category')}>
            {meta.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Thành phố">
        {(id) => (
          <>
            <Input id={id} value={form.city} onChange={set('city')} list="cities" placeholder="Không bắt buộc" maxLength={60} />
            <datalist id="cities">
              {meta.cities.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      <div className="sm:col-span-2">
        <Field label="Chuyến đi">
          {(id) => (
            <Select id={id} value={form.trip_id} onChange={set('trip_id')}>
              <option value="">Không thuộc chuyến nào</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.city} ({dayRange(t.started_on, t.ended_on)})
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {error ? (
        <div className="sm:col-span-2">
          <ErrorBox message={error} />
        </div>
      ) : null}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Hủy
        </Button>
        <Button type="submit" loading={busy}>
          {expense ? 'Lưu thay đổi' : 'Thêm khoản chi'}
        </Button>
      </div>
    </form>
  );
}

import { Banknote, CreditCard as CardIcon, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { MoneyField } from '../components/MoneyField';
import { Button, Card, CardTitle, CategoryBadge, ErrorBox, Field, Input, Modal, Select, Spinner, useToast } from '../components/ui';
import { api, type CreditCharge } from '../lib/api';
import { addMonths, dayLabel, monthLabel, parseMoney, todayVn, vnd, vndShort } from '../lib/format';
import { useApi } from '../lib/use-api';

/** Nợ thẻ tín dụng: quẹt tháng này, ngày 1 tháng sau tự thành chi tiêu của tháng sau. */
export function CreditCardSection({ categories, onChanged }: { categories: string[]; onChanged?: () => void }) {
  const toast = useToast();
  const list = useApi(() => api<{ rows: CreditCharge[] }>('/credit'), 'credit');
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState(false);
  const rows = list.data?.rows ?? [];
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const billed = rows.length ? addMonths(rows[rows.length - 1].spent_on.slice(0, 7), 1) : addMonths(todayVn().slice(0, 7), 1);

  const remove = async (r: CreditCharge) => {
    try {
      await api(`/credit/${r.id}`, { method: 'DELETE' });
      toast(`Đã xóa “${r.item}”`);
      list.reload();
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Card className="p-0">
      <div className="px-4 pt-4 md:px-5">
        <CardTitle
          extra={
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden /> Ghi quẹt thẻ
            </Button>
          }>
          <span className="inline-flex items-center gap-2">
            <CardIcon className="size-4 text-primary" aria-hidden /> Nợ thẻ tín dụng
          </span>
        </CardTitle>
        <p className="mb-3 text-sm text-muted-foreground">
          Không tính vào chi tiêu tháng quẹt. Tiền thẻ được trừ vào ngày 1 tháng sau (thành chi tiêu của tháng đó, giữ danh mục, vào đúng hũ). Trên bot: <code>td phở 45k</code>
        </p>
      </div>
      {list.error ? (
        <div className="px-4 pb-4 md:px-5">
          <ErrorBox message={list.error} onRetry={list.reload} />
        </div>
      ) : null}
      {!list.data && list.loading ? <Spinner /> : null}
      {list.data && rows.length === 0 ? <p className="border-t border-border px-4 py-4 text-sm text-muted-foreground md:px-5">Không có nợ thẻ nào chưa tính.</p> : null}
      {rows.length ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-amber-50 px-4 py-2 text-sm text-amber-900 md:px-5">
            <span>
              Nợ <b className="num">{vnd(total)}</b> ({rows.length} khoản) → trừ vào ngày <b>1/{monthLabel(billed)}</b>
            </span>
            <Button variant="outline" onClick={() => setPaying(true)} className="min-h-9 bg-white">
              <Banknote className="size-4" aria-hidden /> Thanh toán sớm
            </Button>
          </div>
          <ul className="divide-y divide-border border-t border-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-5">
                <div className="min-w-0">
                  <p className="font-medium">{r.item}</p>
                  <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span className="num">{dayLabel(r.spent_on)}</span>
                    <CategoryBadge category={r.category} />
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="num mr-2 font-semibold">{vndShort(r.amount)}</span>
                  <button onClick={() => remove(r)} className="rounded-md p-2 text-muted-foreground hover:bg-red-50 hover:text-destructive" aria-label={`Xóa ${r.item}`}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <Modal open={paying} title="Thanh toán sớm thẻ tín dụng" onClose={() => setPaying(false)}>
        <PayForm
          total={total}
          onCancel={() => setPaying(false)}
          onPaid={(paid, remaining) => {
            toast(remaining ? `Đã trả ${vndShort(paid)}, còn nợ ${vndShort(remaining)}` : `Đã trả ${vndShort(paid)}, hết nợ thẻ`);
            setPaying(false);
            list.reload();
            onChanged?.();
          }}
        />
      </Modal>

      <Modal open={adding} title="Ghi khoản quẹt thẻ" onClose={() => setAdding(false)}>
        <ChargeForm
          categories={categories}
          onCancel={() => setAdding(false)}
          onSaved={() => {
            toast('Đã ghi vào nợ thẻ');
            setAdding(false);
            list.reload();
            onChanged?.();
          }}
        />
      </Modal>
    </Card>
  );
}

/** Trả hết hoặc một phần; khoản được trả thành chi tiêu hôm nay (trả khoản quẹt cũ nhất trước). */
function PayForm({ total, onCancel, onPaid }: { total: number; onCancel: () => void; onPaid: (paid: number, remaining: number) => void }) {
  const [mode, setMode] = useState<'all' | 'part'>('all');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = mode === 'all' ? null : parseMoney(amount);
    if (mode === 'part' && !value) return setError('Nhập số tiền muốn trả');
    setBusy(true);
    setError('');
    try {
      const result = await api<{ paid: number; remaining: number }>('/credit/pay', { method: 'POST', body: { amount: value } });
      onPaid(result.paid, result.remaining);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Số tiền trả</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="pay" className="size-4 accent-primary" checked={mode === 'all'} onChange={() => setMode('all')} />
          Trả hết <b className="num">{vnd(total)}</b>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="pay" className="size-4 accent-primary" checked={mode === 'part'} onChange={() => setMode('part')} />
          Trả một phần
        </label>
      </fieldset>
      {mode === 'part' ? <MoneyField label="Số tiền trả" value={amount} onChange={setAmount} required placeholder="VD 2tr" /> : null}
      <p className="rounded-lg bg-muted px-3 py-2 text-sm">
        Khoản được trả thành chi tiêu <b>hôm nay</b>: trừ vào tiền đang có và tính vào hũ tháng này. Trả một phần thì trả khoản quẹt cũ
        nhất trước, phần còn lại vẫn trừ vào ngày 1 tháng sau.
      </p>
      {error ? <ErrorBox message={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Hủy
        </Button>
        <Button type="submit" loading={busy}>
          Xác nhận đã trả
        </Button>
      </div>
    </form>
  );
}

function ChargeForm({ categories, onCancel, onSaved }: { categories: string[]; onCancel: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ item: '', amount: '', category: 'Ăn uống', spent_on: todayVn() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = parseMoney(form.amount);
    if (!amount) return setError('Số tiền không hợp lệ');
    setBusy(true);
    setError('');
    try {
      await api('/credit', { method: 'POST', body: { ...form, amount } });
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
        <Field label="Khoản chi">{(id) => <Input id={id} value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} required maxLength={80} />}</Field>
      </div>
      <MoneyField label="Số tiền" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} required />
      <Field label="Ngày quẹt">
        {(id) => <Input id={id} type="date" max={todayVn()} value={form.spent_on} onChange={(e) => setForm({ ...form, spent_on: e.target.value })} required />}
      </Field>
      <div className="sm:col-span-2">
        <Field label="Danh mục">
          {(id) => (
            <Select id={id} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
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
          Lưu
        </Button>
      </div>
    </form>
  );
}

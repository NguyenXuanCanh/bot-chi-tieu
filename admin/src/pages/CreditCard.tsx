import { Banknote, CreditCard as CardIcon, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { MoneyField } from '../components/MoneyField';
import { Button, Card, CardTitle, CategoryBadge, ErrorBox, Field, Input, Modal, Select, Spinner, useToast } from '../components/ui';
import { api, type CreditCharge } from '../lib/api';
import { addMonths, dayLabel, monthLabel, parseMoney, PAYLATER, paylaterOf, todayVn, vnd, vndShort } from '../lib/format';
import { useApi } from '../lib/use-api';

/** Nhãn nguồn trả sau: chấm màu + tên. */
export function PaylaterBadge({ provider }: { provider: string }) {
  const p = paylaterOf(provider);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
      <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />
      {p.name}
    </span>
  );
}

/** Dư nợ trả sau (thẻ tín dụng, MoMo / ZaloPay / SPayLater trả sau…): mua tháng này, ngày 1 tháng sau tự thành chi tiêu. */
export function CreditCardSection({ categories, onChanged }: { categories: string[]; onChanged?: () => void }) {
  const toast = useToast();
  const list = useApi(() => api<{ rows: CreditCharge[] }>('/credit'), 'credit');
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState(false);
  const rows = list.data?.rows ?? [];
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const billed = rows.length ? addMonths(rows[rows.length - 1].spent_on.slice(0, 7), 1) : addMonths(todayVn().slice(0, 7), 1);
  const groups = PAYLATER.map((p) => ({ ...p, total: rows.filter((r) => r.provider === p.key).reduce((s, r) => s + r.amount, 0) })).filter((g) => g.total > 0);

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
  const changed = () => {
    list.reload();
    onChanged?.();
  };

  return (
    <Card className="p-0">
      <div className="px-4 pt-4 md:px-5">
        <CardTitle
          extra={
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden /> <span className="sm:hidden">Ghi</span>
              <span className="hidden sm:inline">Ghi khoản trả sau</span>
            </Button>
          }>
          <span className="inline-flex items-center gap-2">
            <CardIcon className="size-4 text-primary" aria-hidden /> Dư nợ trả sau
          </span>
        </CardTitle>
        <p className="mb-3 text-sm text-muted-foreground">
          Thẻ tín dụng, MoMo / ZaloPay / SPayLater trả sau… Không tính vào chi tiêu tháng mua; trừ vào ngày 1 tháng sau (thành chi tiêu của
          tháng đó, giữ danh mục, vào đúng hũ). Trên bot: <code>td phở 45k</code> · <code>ts momo phở 45k</code>
        </p>
      </div>
      {list.error ? (
        <div className="px-4 pb-4 md:px-5">
          <ErrorBox message={list.error} onRetry={list.reload} />
        </div>
      ) : null}
      {!list.data && list.loading ? <Spinner /> : null}
      {list.data && rows.length === 0 ? <p className="border-t border-border px-4 py-4 text-sm text-muted-foreground md:px-5">Không có dư nợ trả sau.</p> : null}
      {rows.length ? (
        <>
          <div className="flex flex-col gap-2 border-t border-border bg-amber-50 px-4 py-2.5 text-sm text-amber-900 md:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Dư nợ <b className="num">{vnd(total)}</b> ({rows.length} khoản) → trừ vào ngày <b>1/{monthLabel(billed)}</b>
              </span>
              <Button variant="outline" onClick={() => setPaying(true)} className="min-h-9 bg-white">
                <Banknote className="size-4" aria-hidden /> Thanh toán sớm
              </Button>
            </div>
            {groups.length > 1 ? (
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {groups.map((g) => (
                  <li key={g.key} className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: g.color }} aria-hidden />
                    {g.name}: <b className="num">{vndShort(g.total)}</b>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <ul className="divide-y divide-border border-t border-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-5">
                <div className="min-w-0">
                  <p className="font-medium">{r.item}</p>
                  <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span className="num">{dayLabel(r.spent_on)}</span>
                    <PaylaterBadge provider={r.provider} />
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

      <Modal open={paying} title="Thanh toán sớm dư nợ trả sau" onClose={() => setPaying(false)}>
        <PayForm
          rows={rows}
          onCancel={() => setPaying(false)}
          onPaid={(paid, remaining) => {
            toast(remaining ? `Đã trả ${vndShort(paid)}, còn ${vndShort(remaining)}` : `Đã trả ${vndShort(paid)}`);
            setPaying(false);
            changed();
          }}
        />
      </Modal>

      <Modal open={adding} title="Ghi khoản trả sau" onClose={() => setAdding(false)}>
        <ChargeForm
          categories={categories}
          onCancel={() => setAdding(false)}
          onSaved={() => {
            toast('Đã ghi vào dư nợ trả sau');
            setAdding(false);
            changed();
          }}
        />
      </Modal>
    </Card>
  );
}

/** Trả hết hoặc một phần, mọi nguồn hoặc một nguồn; khoản được trả thành chi tiêu hôm nay (khoản cũ nhất trước). */
function PayForm({ rows, onCancel, onPaid }: { rows: CreditCharge[]; onCancel: () => void; onPaid: (paid: number, remaining: number) => void }) {
  const providers = PAYLATER.filter((p) => rows.some((r) => r.provider === p.key));
  const [provider, setProvider] = useState('');
  const [mode, setMode] = useState<'all' | 'part'>('all');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const debt = rows.filter((r) => !provider || r.provider === provider).reduce((s, r) => s + r.amount, 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = mode === 'all' ? null : parseMoney(amount);
    if (mode === 'part' && !value) return setError('Nhập số tiền muốn trả');
    setBusy(true);
    setError('');
    try {
      const result = await api<{ paid: number; remaining: number }>('/credit/pay', { method: 'POST', body: { amount: value, provider: provider || undefined } });
      onPaid(result.paid, result.remaining);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {providers.length > 1 ? (
        <Field label="Trả cho">
          {(id) => (
            <Select id={id} value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="">Tất cả nguồn</option>
              {providers.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Số tiền trả</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="pay" className="size-4 accent-primary" checked={mode === 'all'} onChange={() => setMode('all')} />
          Trả hết <b className="num">{vnd(debt)}</b>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="pay" className="size-4 accent-primary" checked={mode === 'part'} onChange={() => setMode('part')} />
          Trả một phần
        </label>
      </fieldset>
      {mode === 'part' ? <MoneyField label="Số tiền trả" value={amount} onChange={setAmount} required placeholder="VD 2tr" /> : null}
      <p className="rounded-lg bg-muted px-3 py-2 text-sm">
        Khoản được trả thành chi tiêu <b>hôm nay</b>: trừ vào tiền đang có và tính vào hũ tháng này. Trả một phần thì trả khoản cũ nhất
        trước, phần còn lại vẫn trừ vào ngày 1 tháng sau.
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
  const [form, setForm] = useState({ item: '', amount: '', category: 'Ăn uống', spent_on: todayVn(), provider: 'card' });
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
        <Field label="Trả sau qua">
          {(id) => (
            <Select id={id} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              {PAYLATER.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Khoản chi">{(id) => <Input id={id} value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} required maxLength={80} />}</Field>
      </div>
      <MoneyField label="Số tiền" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} required />
      <Field label="Ngày mua">
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

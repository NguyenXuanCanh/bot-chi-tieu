import { ArrowDownLeft, ArrowUpRight, CheckCircle2, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { MoneyField, moneyText } from '../components/MoneyField';
import { Button, Card, CardTitle, cx, EmptyState, ErrorBox, Field, Input, Modal, Spinner, useToast } from '../components/ui';
import { api } from '../lib/api';
import { dayLabel, parseMoney, todayVn, vnd, vndShort } from '../lib/format';
import { useApi } from '../lib/use-api';

type Debt = {
  id: number;
  direction: 'lend' | 'borrow';
  person: string;
  amount: number;
  note: string | null;
  start_on: string;
  due_on: string | null;
  counts_balance: number;
  settled_at: number | null;
  paid: number;
  remaining: number;
};
type DebtsData = {
  open: Debt[];
  settled: Debt[];
  payments: { id: number; debt_id: number; amount: number; paid_on: string }[];
  totals: { owedToMe: number; iOwe: number };
  today: string;
};

/** Sổ nợ: cho mượn / đi vay, trả dần. Không phải chi tiêu nên không vào hũ, nhưng có cộng/trừ tiền đang có. */
export default function DebtsPage() {
  const toast = useToast();
  const data = useApi(() => api<DebtsData>('/debts'), 'debts');
  const [editing, setEditing] = useState<Debt | 'lend' | 'borrow' | null>(null);
  const [paying, setPaying] = useState<Debt | null>(null);
  const [deleting, setDeleting] = useState<Debt | null>(null);
  const [showSettled, setShowSettled] = useState(false);

  const remove = async () => {
    if (!deleting) return;
    try {
      await api(`/debts/${deleting.id}`, { method: 'DELETE' });
      toast('Đã xóa khoản nợ');
      setDeleting(null);
      data.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const d = data.data;
  const lend = d?.open.filter((x) => x.direction === 'lend') ?? [];
  const borrow = d?.open.filter((x) => x.direction === 'borrow') ?? [];
  const paymentsOf = (id: number) => d?.payments.filter((p) => p.debt_id === id) ?? [];

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sổ nợ</h1>
          <p className="text-sm text-muted-foreground">Cho mượn, đi vay và trả dần. Không tính là chi tiêu, nhưng có cộng/trừ tiền đang có.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditing('borrow')}>
            <ArrowDownLeft className="size-4" aria-hidden /> Ghi đi vay
          </Button>
          <Button onClick={() => setEditing('lend')}>
            <Plus className="size-4" aria-hidden /> Ghi cho mượn
          </Button>
        </div>
      </header>

      {data.error ? <ErrorBox message={data.error} onRetry={data.reload} /> : null}
      {!d && data.loading ? <Spinner /> : null}
      {d ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4">
            <Total icon={ArrowUpRight} label="Người khác nợ bạn" value={d.totals.owedToMe} tone="good" count={lend.length} />
            <Total icon={ArrowDownLeft} label="Bạn đang nợ" value={d.totals.iOwe} tone="bad" count={borrow.length} />
          </div>

          {!d.open.length ? (
            <Card>
              <EmptyState
                title="Sổ nợ đang trống"
                desc='Trên bot nhắn "cho Nam mượn 500k hẹn 15/11" hoặc "vay Hùng 2tr"; khi trả nhắn "Nam trả 200k". Hoặc bấm nút phía trên.'
              />
            </Card>
          ) : (
            <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
              <DebtList title="Người khác nợ bạn" empty="Không ai nợ bạn." rows={lend} today={d.today} paymentsOf={paymentsOf} onPay={setPaying} onEdit={setEditing} onDelete={setDeleting} />
              <DebtList title="Bạn đang nợ" empty="Bạn không nợ ai." rows={borrow} today={d.today} paymentsOf={paymentsOf} onPay={setPaying} onEdit={setEditing} onDelete={setDeleting} />
            </div>
          )}

          {d.settled.length ? (
            <Card className="p-0">
              <button
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold md:px-5"
                onClick={() => setShowSettled((v) => !v)}
                aria-expanded={showSettled}>
                Đã trả xong ({d.settled.length})
                <ChevronDown className={cx('size-4 transition-transform duration-150', showSettled && 'rotate-180')} aria-hidden />
              </button>
              {showSettled ? (
                <ul className="divide-y divide-border border-t border-border">
                  {d.settled.map((x) => (
                    <li key={x.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm md:px-5">
                      <span className="min-w-0">
                        <CheckCircle2 className="mr-1.5 inline size-4 text-success" aria-hidden />
                        {x.direction === 'lend' ? `${x.person} đã trả bạn` : `Bạn đã trả ${x.person}`}
                        <span className="text-muted-foreground"> · từ {dayLabel(x.start_on)}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="num font-semibold">{vndShort(x.amount)}</span>
                        <button onClick={() => setDeleting(x)} className="rounded-md p-2 text-muted-foreground hover:bg-red-50 hover:text-destructive" aria-label={`Xóa ${x.person}`}>
                          <Trash2 className="size-4" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}

      <Modal
        open={editing !== null}
        title={editing && typeof editing === 'object' ? 'Sửa khoản nợ' : editing === 'borrow' ? 'Ghi đi vay' : 'Ghi cho mượn'}
        onClose={() => setEditing(null)}>
        {editing ? (
          <DebtForm
            value={typeof editing === 'object' ? editing : undefined}
            direction={typeof editing === 'object' ? editing.direction : editing}
            onCancel={() => setEditing(null)}
            onSaved={(msg) => {
              toast(msg);
              setEditing(null);
              data.reload();
            }}
          />
        ) : null}
      </Modal>
      <Modal open={paying !== null} title={paying?.direction === 'lend' ? `${paying?.person} trả bạn` : `Bạn trả ${paying?.person ?? ''}`} onClose={() => setPaying(null)}>
        {paying ? (
          <PayForm
            debt={paying}
            onCancel={() => setPaying(null)}
            onPaid={(paid) => {
              toast(`Đã ghi trả ${vndShort(paid)}`);
              setPaying(null);
              data.reload();
            }}
          />
        ) : null}
      </Modal>
      <Modal open={deleting !== null} title="Xóa khoản nợ?" onClose={() => setDeleting(null)}>
        <p>
          Xóa khoản nợ <b>{deleting?.person}</b> ({deleting ? vnd(deleting.amount) : ''}) cùng các lần trả? Số dư sẽ tính lại như chưa từng ghi.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleting(null)}>
            Hủy
          </Button>
          <Button variant="danger" onClick={remove}>
            Xóa
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Total({ icon: Icon, label, value, tone, count }: { icon: typeof ArrowUpRight; label: string; value: number; tone: 'good' | 'bad'; count: number }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Icon className={cx('size-4', tone === 'good' ? 'text-success' : 'text-destructive')} aria-hidden />
        {label}
      </p>
      <p className={cx('num mt-1 text-xl font-semibold md:text-2xl', value ? (tone === 'good' ? 'text-success' : 'text-destructive') : 'text-muted-foreground')}>{vnd(value)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{count} khoản</p>
    </Card>
  );
}

function DebtList({
  title,
  empty,
  rows,
  today,
  paymentsOf,
  onPay,
  onEdit,
  onDelete,
}: {
  title: string;
  empty: string;
  rows: Debt[];
  today: string;
  paymentsOf: (id: number) => { id: number; amount: number; paid_on: string }[];
  onPay: (d: Debt) => void;
  onEdit: (d: Debt) => void;
  onDelete: (d: Debt) => void;
}) {
  return (
    <Card className="p-0">
      <div className="px-4 pt-4 md:px-5">
        <CardTitle>{title}</CardTitle>
      </div>
      {!rows.length ? <p className="px-4 pb-4 text-sm text-muted-foreground md:px-5">{empty}</p> : null}
      <ul className="divide-y divide-border border-t border-border">
        {rows.map((x) => {
          const overdue = !!x.due_on && x.due_on < today;
          const history = paymentsOf(x.id);
          return (
            <li key={x.id} className="px-4 py-3 md:px-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{x.person}</p>
                  <p className="text-xs text-muted-foreground">
                    Từ {dayLabel(x.start_on)}
                    {x.due_on ? (
                      <span className={cx(overdue && 'font-semibold text-destructive')}>
                        {' '}
                        · {overdue ? 'quá hạn' : 'hẹn'} {dayLabel(x.due_on)}
                      </span>
                    ) : null}
                    {x.note ? ` · ${x.note}` : ''}
                    {!x.counts_balance ? ' · nợ cũ' : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="num font-semibold">{vndShort(x.remaining)}</p>
                  {x.paid ? <p className="num text-xs text-muted-foreground">/ {vndShort(x.amount)}</p> : null}
                </div>
              </div>
              {x.paid ? (
                <div className="mt-2 h-1.5 rounded-full bg-muted" aria-hidden>
                  <div className="h-1.5 rounded-full bg-success" style={{ width: `${(x.paid / x.amount) * 100}%` }} />
                </div>
              ) : null}
              {history.length ? (
                <p className="mt-1 text-xs text-muted-foreground">Đã trả: {history.map((p) => `${vndShort(p.amount)} (${dayLabel(p.paid_on)})`).join(', ')}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1">
                <Button variant="outline" className="min-h-9 px-3" onClick={() => onPay(x)}>
                  {x.direction === 'lend' ? 'Ghi được trả' : 'Ghi đã trả'}
                </Button>
                <button onClick={() => onEdit(x)} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Sửa ${x.person}`}>
                  <Pencil className="size-4" />
                </button>
                <button onClick={() => onDelete(x)} className="rounded-md p-2 text-muted-foreground hover:bg-red-50 hover:text-destructive" aria-label={`Xóa ${x.person}`}>
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function DebtForm({ value, direction, onCancel, onSaved }: { value?: Debt; direction: 'lend' | 'borrow'; onCancel: () => void; onSaved: (msg: string) => void }) {
  const [form, setForm] = useState({
    person: value?.person ?? '',
    amount: value ? moneyText(value.amount) : '',
    note: value?.note ?? '',
    start_on: value?.start_on ?? todayVn(),
    due_on: value?.due_on ?? '',
    old: value ? !value.counts_balance : false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = parseMoney(form.amount);
    if (!amount) return setError('Số tiền không hợp lệ');
    setBusy(true);
    setError('');
    const body = { direction, person: form.person, amount, note: form.note, start_on: form.start_on, due_on: form.due_on || null, counts_balance: !form.old };
    try {
      if (value) await api(`/debts/${value.id}`, { method: 'PATCH', body });
      else await api('/debts', { method: 'POST', body });
      onSaved(value ? 'Đã lưu' : 'Đã ghi vào sổ nợ');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label={direction === 'lend' ? 'Cho ai mượn' : 'Vay của ai'}>
        {(id) => <Input id={id} value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })} required maxLength={40} placeholder="VD Nam" />}
      </Field>
      <MoneyField label="Số tiền" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} required />
      <Field label="Ngày mượn">
        {(id) => <Input id={id} type="date" max={todayVn()} value={form.start_on} disabled={!!value} onChange={(e) => setForm({ ...form, start_on: e.target.value })} required />}
      </Field>
      <Field label="Hẹn trả (không bắt buộc)" hint="Tới ngày bot sẽ nhắc">
        {(id) => <Input id={id} type="date" value={form.due_on} onChange={(e) => setForm({ ...form, due_on: e.target.value })} />}
      </Field>
      <div className="sm:col-span-2">
        <Field label="Ghi chú">{(id) => <Input id={id} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={80} placeholder="VD tiền ăn trưa" />}</Field>
      </div>
      <label className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm sm:col-span-2">
        <input type="checkbox" className="mt-1 size-4 accent-primary" checked={form.old} onChange={(e) => setForm({ ...form, old: e.target.checked })} />
        <span>
          Nợ cũ: tiền đã {direction === 'lend' ? 'đưa đi' : 'nhận về'} từ trước khi bạn nhập số dư, nên <b>không {direction === 'lend' ? 'trừ' : 'cộng'} lại</b> vào tiền đang có.
          Các lần trả sau này vẫn được tính.
        </span>
      </label>
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

function PayForm({ debt, onCancel, onPaid }: { debt: Debt; onCancel: () => void; onPaid: (paid: number) => void }) {
  const [mode, setMode] = useState<'all' | 'part'>('all');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(todayVn());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = mode === 'all' ? null : parseMoney(amount);
    if (mode === 'part' && !value) return setError('Nhập số tiền');
    setBusy(true);
    setError('');
    try {
      const r = await api<{ paid: number }>(`/debts/${debt.id}/pay`, { method: 'POST', body: { amount: value, paid_on: day } });
      onPaid(r.paid);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Số tiền</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="debt-pay" className="size-4 accent-primary" checked={mode === 'all'} onChange={() => setMode('all')} />
          Trả hết <b className="num">{vnd(debt.remaining)}</b>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="debt-pay" className="size-4 accent-primary" checked={mode === 'part'} onChange={() => setMode('part')} />
          Trả một phần
        </label>
      </fieldset>
      {mode === 'part' ? <MoneyField label="Số tiền" value={amount} onChange={setAmount} required placeholder="VD 200k" /> : null}
      <Field label="Ngày trả">{(id) => <Input id={id} type="date" max={todayVn()} value={day} onChange={(e) => setDay(e.target.value)} required />}</Field>
      <p className="rounded-lg bg-muted px-3 py-2 text-sm">
        {debt.direction === 'lend' ? 'Tiền được trả sẽ cộng vào' : 'Tiền bạn trả sẽ trừ khỏi'} tiền đang có, không tính là thu nhập / chi tiêu.
      </p>
      {error ? <ErrorBox message={error} /> : null}
      <div className="flex justify-end gap-2">
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

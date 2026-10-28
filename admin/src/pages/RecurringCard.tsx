import { CheckCircle2, Pause, Pencil, Play, Plus, Repeat, Trash2, Zap } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';

import { MoneyField, moneyText } from '../components/MoneyField';
import { Button, Card, CardTitle, CategoryBadge, cx, ErrorBox, Field, Input, Modal, Select, Spinner, useToast } from '../components/ui';
import { api, type Recurring } from '../lib/api';
import { monthLabel, parseMoney, todayVn, vnd, vndShort } from '../lib/format';
import { useApi } from '../lib/use-api';

/** Khoản chi cố định hàng tháng: cron tự ghi thành chi tiêu vào ngày đã hẹn. */
export function RecurringCard({ categories, onCharged }: { categories: string[]; onCharged: () => void }) {
  const toast = useToast();
  const list = useApi(() => api<{ rows: Recurring[]; month: string }>('/recurring'), 'recurring');
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Recurring | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const rows = list.data?.rows ?? [];
  const month = list.data?.month ?? todayVn().slice(0, 7);
  const today = Number(todayVn().slice(8, 10));
  const active = rows.filter((r) => r.active);
  const total = active.reduce((s, r) => s + r.amount, 0);

  const act = async (r: Recurring, fn: () => Promise<unknown>, message: string, charged = false) => {
    setBusy(r.id);
    try {
      await fn();
      toast(message);
      list.reload();
      if (charged) onCharged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-0">
      <div className="px-4 pt-4 md:px-5">
        <CardTitle
          extra={
            <Button variant="outline" onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> Thêm khoản
            </Button>
          }>
          <span className="inline-flex items-center gap-2">
            <Repeat className="size-4 text-primary" aria-hidden /> Chi cố định hàng tháng
          </span>
        </CardTitle>
        <p className="mb-3 text-sm text-muted-foreground">
          Tự ghi vào chi tiêu lúc 0h ngày đã hẹn và nhắn Telegram báo.
          {active.length ? (
            <>
              {' '}
              Tổng <b className="num text-foreground">{vnd(total)}</b>/tháng.
            </>
          ) : null}
        </p>
      </div>
      {list.error ? (
        <div className="px-4 pb-4 md:px-5">
          <ErrorBox message={list.error} onRetry={list.reload} />
        </div>
      ) : null}
      {!list.data && list.loading ? <Spinner /> : null}
      {list.data && rows.length === 0 ? (
        <p className="border-t border-border px-4 py-4 text-sm text-muted-foreground md:px-5">
          Chưa có. VD tiền nhà, điện nước, Netflix, trả góp. Trên bot: <code>/codinh tiền nhà 5tr ngày 5</code>
        </p>
      ) : null}
      {rows.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((r) => {
            const done = r.last_month === month;
            return (
              <li key={r.id} className={cx('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 md:px-5', !r.active && 'opacity-60')}>
                <div className="min-w-0">
                  <p className="font-medium">
                    {r.item} {!r.active ? <span className="text-xs font-normal text-muted-foreground">(tạm dừng)</span> : null}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <CategoryBadge category={r.category} />
                    <span>Ngày {r.day} hằng tháng</span>
                    {r.active ? (
                      done ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <CheckCircle2 className="size-3.5" aria-hidden /> Đã trừ tháng này
                        </span>
                      ) : (
                        <span>
                          {r.start_month > month ? `Bắt đầu từ tháng ${monthLabel(r.start_month)}` : r.day > today ? `Sẽ trừ ngày ${r.day}` : 'Chưa trừ tháng này'}
                        </span>
                      )
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="num mr-2 font-semibold">{vndShort(r.amount)}</span>
                  {r.active && !done ? (
                    <IconButton
                      label="Trừ luôn tháng này"
                      busy={busy === r.id}
                      onClick={() => act(r, () => api(`/recurring/${r.id}/charge`, { method: 'POST' }), `Đã trừ “${r.item}” tháng này`, true)}>
                      <Zap className="size-4" />
                    </IconButton>
                  ) : null}
                  <IconButton
                    label={r.active ? 'Tạm dừng' : 'Bật lại'}
                    onClick={() =>
                      act(r, () => api(`/recurring/${r.id}`, { method: 'PATCH', body: { ...r, active: !r.active } }), r.active ? 'Đã tạm dừng' : 'Đã bật lại')
                    }>
                    {r.active ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </IconButton>
                  <IconButton label="Sửa" onClick={() => setEditing(r)}>
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton label="Xóa" danger onClick={() => setDeleting(r)}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Modal open={editing !== null} title={editing === 'new' ? 'Thêm khoản cố định' : 'Sửa khoản cố định'} onClose={() => setEditing(null)}>
        <RecurringForm
          value={editing && editing !== 'new' ? editing : undefined}
          categories={categories}
          onCancel={() => setEditing(null)}
          onSaved={(charged) => {
            toast(charged ? 'Đã thêm và trừ luôn tháng này' : editing === 'new' ? 'Đã thêm khoản cố định' : 'Đã lưu');
            setEditing(null);
            list.reload();
            if (charged) onCharged();
          }}
        />
      </Modal>
      <Modal open={deleting !== null} title="Xóa khoản cố định?" onClose={() => setDeleting(null)}>
        <p>
          Xóa <b>{deleting?.item}</b>? Từ tháng sau sẽ không tự trừ nữa; các lần đã trừ trước vẫn nằm trong chi tiêu.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleting(null)}>
            Hủy
          </Button>
          <Button
            variant="danger"
            loading={busy === deleting?.id}
            onClick={() => deleting && act(deleting, () => api(`/recurring/${deleting.id}`, { method: 'DELETE' }), 'Đã xóa').then(() => setDeleting(null))}>
            Xóa
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

function IconButton({ label, onClick, children, danger, busy }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={label}
      aria-label={label}
      className={cx(
        'rounded-md p-2 text-muted-foreground disabled:opacity-50',
        danger ? 'hover:bg-red-50 hover:text-destructive' : 'hover:bg-muted hover:text-foreground',
      )}>
      {children}
    </button>
  );
}

function RecurringForm({
  value,
  categories,
  onCancel,
  onSaved,
}: {
  value?: Recurring;
  categories: string[];
  onCancel: () => void;
  onSaved: (charged: boolean) => void;
}) {
  const today = Number(todayVn().slice(8, 10));
  const [form, setForm] = useState({
    item: value?.item ?? '',
    amount: value ? moneyText(value.amount) : '',
    category: value?.category ?? 'Hóa đơn & nhà cửa',
    day: String(value?.day ?? 1),
    chargeNow: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const day = Number(form.day);
  const passed = !value && day >= 1 && day <= today;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = parseMoney(form.amount);
    if (!amount) return setError('Số tiền không hợp lệ');
    setBusy(true);
    setError('');
    const body = { item: form.item, amount, category: form.category, day, active: value ? value.active : 1 };
    try {
      if (value) {
        await api(`/recurring/${value.id}`, { method: 'PATCH', body });
        onSaved(false);
      } else {
        const result = await api<{ charged: boolean }>('/recurring', { method: 'POST', body: { ...body, charge_now: passed && form.chargeNow } });
        onSaved(result.charged);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Tên khoản">
          {(id) => <Input id={id} value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} required maxLength={80} placeholder="Tiền nhà, Netflix, trả góp…" />}
        </Field>
      </div>
      <MoneyField label="Số tiền mỗi tháng" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} required />
      <Field label="Ngày trừ trong tháng" hint="Tháng không có ngày này thì trừ ngày cuối tháng">
        {(id) => <Input id={id} type="number" min={1} max={31} value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} required className="num" />}
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
      {passed ? (
        <label className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-1 size-4 accent-primary" checked={form.chargeNow} onChange={(e) => setForm({ ...form, chargeNow: e.target.checked })} />
          <span>
            Trừ luôn tháng này. Tháng này đã qua ngày {day}; bỏ chọn nếu bạn đã tự ghi khoản này, sẽ bắt đầu từ tháng sau.
          </span>
        </label>
      ) : null}
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

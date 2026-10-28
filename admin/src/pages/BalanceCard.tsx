import { Wallet } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';

import { MoneyField } from '../components/MoneyField';
import { Button, Card, cx, ErrorBox, Spinner, useToast } from '../components/ui';
import { api, type Forecast } from '../lib/api';
import { dayLabel, monthLabel, parseMoney, vnd, vndShort } from '../lib/format';
import { useApi } from '../lib/use-api';

/** Số dư đang có + dự báo cuối tháng này và cuối tháng sau. `version` đổi khi dữ liệu ngân sách đổi để tải lại. */
export function BalanceCard({ version }: { version: number }) {
  const toast = useToast();
  const data = useApi(() => api<{ forecast: Forecast | null }>('/balance'), `balance-${version}`);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState<Forecast | null>(null);
  const f = override ?? data.data?.forecast ?? null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = parseMoney(value);
    if (amount === null) return toast('Số tiền không hợp lệ', 'error');
    setBusy(true);
    try {
      setOverride((await api<{ forecast: Forecast }>('/balance', { method: 'POST', body: { amount } })).forecast);
      setValue('');
      toast('Đã lưu số dư');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (data.error) return <ErrorBox message={data.error} onRetry={data.reload} />;
  if (!data.data) return <Spinner />;

  return (
    <Card>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="flex flex-col gap-3">
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Wallet className="size-4 text-primary" aria-hidden /> Tiền đang có
          </p>
          {f ? (
            <>
              <p className={cx('num text-3xl font-semibold', f.balance.now < 0 ? 'text-destructive' : 'text-foreground')}>{vnd(f.balance.now)}</p>
              <p className="text-xs text-muted-foreground">
                Nhập {vndShort(f.balance.snapshot.amount)} ngày {dayLabel(f.balance.snapshot.day)}
                {f.balance.incomeSince ? ` + thu ${vndShort(f.balance.incomeSince)}` : ''}
                {f.balance.spentSince ? ` − chi ${vndShort(f.balance.spentSince)}` : ''} từ đó. Quẹt thẻ chưa trừ cho tới khi trả thẻ.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Nhập tổng tiền mặt + tài khoản đang có để biết cuối tháng và tháng sau còn bao nhiêu.</p>
          )}
          <form onSubmit={submit} className="flex items-start gap-2">
            <div className="flex-1">
              <MoneyField label={f ? 'Cập nhật số dư thật' : 'Số dư đang có'} value={value} onChange={setValue} required placeholder="VD 15tr" />
            </div>
            <Button type="submit" loading={busy} className="mt-[26px]">
              Lưu
            </Button>
          </form>
        </div>

        {f ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Projection
              title={`Cuối tháng ${monthLabel(f.month)}`}
              sub={`còn ${f.daysLeft} ngày`}
              total={f.endOfMonth}
              rows={[
                ...f.incomePending.map((r) => ({ label: `${r.note} (ngày ${r.day})${r.expected ? ', chưa nhập' : ''}`, value: r.amount })),
                ...f.fixedPending.map((r) => ({ label: `${r.item} (cố định, ngày ${r.day})`, value: -r.amount })),
                { label: f.moreSpendBasis === 'jars' ? 'Chi tiếp (phần còn lại của các hũ)' : 'Chi tiếp (theo mức chi mỗi ngày)', value: -f.moreSpend },
              ]}
            />
            <Projection
              title={`Cuối tháng ${monthLabel(f.next.month)}`}
              total={f.next.end}
              rows={[
                { label: f.next.income ? `Lương ngày ${f.payday}/${Number(f.next.month.slice(5))} (TB các tháng)` : 'Lương (chưa nhập tháng nào)', value: f.next.income },
                ...(f.next.creditDebt ? [{ label: `Trả thẻ tín dụng (ngày 1/${Number(f.next.month.slice(5))})`, value: -f.next.creditDebt }] : []),
                { label: f.next.spendBasis === 'jars' ? 'Chi theo hũ' : 'Chi như tháng này', value: -f.next.spend },
              ]}
            />
            {f.incomeThisMonthMissing ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:col-span-2">
                Đã qua ngày lương ({f.payday}) mà tháng này chưa nhập lương. Nhận rồi thì thêm thu nhập để số dư cộng vào.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Projection({ title, sub, rows, total }: { title: string; sub?: string; rows: { label: string; value: number }[]; total: number }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-background p-3">
      <p className="text-sm font-semibold">
        {title} {sub ? <span className="font-normal text-muted-foreground">· {sub}</span> : null}
      </p>
      <ul className="mt-2 flex flex-1 flex-col gap-1 text-sm">
        {rows.map((r) => (
          <Row key={r.label} label={r.label}>
            <span className={cx('num', r.value < 0 ? 'text-muted-foreground' : 'text-success')}>
              {r.value < 0 ? '−' : '+'}
              {vndShort(Math.abs(r.value))}
            </span>
          </Row>
        ))}
      </ul>
      <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
        <span className="text-sm text-muted-foreground">Còn khoảng</span>
        <span className={cx('num text-lg font-semibold', total < 0 ? 'text-destructive' : 'text-foreground')}>{vnd(total)}</span>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 text-muted-foreground">{label}</span>
      {children}
    </li>
  );
}

import { ChevronLeft, ChevronRight, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { MoneyField, moneyText } from '../components/MoneyField';
import { Button, Card, CardTitle, CategoryBadge, cx, ErrorBox, Field, Input, Select, Spinner, useToast } from '../components/ui';
import { api, type BudgetData, type JarKey, type JarStatus, type MonthStatus } from '../lib/api';
import { JAR_STYLE, parseMoney, vnd, vndShort } from '../lib/format';
import { useApi } from '../lib/use-api';
import { BalanceCard } from './BalanceCard';
import { CreditCardSection } from './CreditCard';
import { RecurringCard } from './RecurringCard';
import { SalaryBanner } from './SalaryBanner';

export default function BudgetPage() {
  // Kỳ đang xem: '' = kỳ hiện tại; kỳ = từ lần nhận lương (hoặc tháng lịch nếu chưa nhận lần nào).
  const [periodKey, setPeriodKey] = useState('');
  const data = useApi(() => api<BudgetData>('/budget', { query: { period: periodKey } }), `budget-${periodKey}`);
  const periods = data.data?.periods ?? [];
  const index = Math.max(0, periods.findIndex((p) => p.key === (periodKey || periods[0]?.key)));
  const isCurrent = index === 0;
  // Tăng mỗi lần dữ liệu đổi để thẻ số dư tính lại.
  const [version, setVersion] = useState(0);
  const reload = () => {
    data.reload();
    setVersion((v) => v + 1);
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Ngân sách</h1>
          <p className="text-sm text-muted-foreground">Lương chia theo hũ, so với chi tiêu thực tế</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          <button
            className="rounded-md p-2 hover:bg-muted disabled:opacity-40"
            onClick={() => setPeriodKey(periods[index + 1].key)}
            disabled={index >= periods.length - 1}
            aria-label="Kỳ trước">
            <ChevronLeft className="size-4" />
          </button>
          <span className="num min-w-32 text-center text-sm font-semibold">{data.data?.status.period.label ?? '…'}</span>
          <button
            className="rounded-md p-2 hover:bg-muted disabled:opacity-40"
            onClick={() => setPeriodKey(index <= 1 ? '' : periods[index - 1].key)}
            disabled={isCurrent}
            aria-label="Kỳ sau">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </header>

      <SalaryBanner key={`s${version}`} onReceived={() => {
        setPeriodKey('');
        reload();
      }} />

      {data.error ? <ErrorBox message={data.error} onRetry={data.reload} /> : null}
      {!data.data && data.loading ? <Spinner /> : null}
      {isCurrent ? <BalanceCard key={version} version={version} /> : null}
      {data.data ? <BudgetBody data={data.data} reload={reload} /> : null}
    </div>
  );
}

function BudgetBody({ data, reload }: { data: BudgetData; reload: () => void }) {
  const s = data.status;
  const allocated = s.jars.reduce((sum, j) => sum + j.budget, 0);
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:gap-4">
        <Kpi label="Thu nhập" value={s.income ? vnd(s.income) : 'Chưa nhập'} muted={!s.income} />
        <Kpi label="Đã chi" value={vnd(s.spent)} sub={s.daysPassed ? `${s.daysPassed}/${s.daysInMonth} ngày` : undefined} />
        <Kpi
          label="Còn dư"
          value={s.saved === null ? '—' : vnd(s.saved)}
          tone={s.saved !== null && s.saved < 0 ? 'bad' : 'good'}
          sub={s.saved === null ? 'Nhập lương để tính' : `Muốn để dành ${vndShort(s.jars.find((j) => j.key === 'tiet_kiem')?.budget ?? 0)}`}
        />
      </div>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardTitle>Các hũ</CardTitle>
          {allocated === 0 ? (
            <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-sm">Chưa chia hũ. Nhập số tiền cho từng hũ ở mục “Chia lương” bên dưới.</p>
          ) : null}
          <ul className="flex flex-col gap-4">
            {s.jars.map((j) => (
              <JarRow key={j.key} jar={j} status={s} />
            ))}
          </ul>
        </Card>
        <ReviewCard period={s.period.key} />
      </div>

      <div className="grid gap-4 md:gap-6 xl:grid-cols-2">
        <RecurringCard categories={data.categories} onCharged={reload} />
        <CreditCardSection categories={data.categories} onChanged={reload} />
      </div>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
        <IncomeCard status={s} onChanged={reload} />
        <SplitCard status={s} onSaved={reload} />
      </div>
      <MappingCard data={data} onSaved={reload} />
    </>
  );
}

function Kpi({ label, value, sub, tone, muted }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad'; muted?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={cx(
          'num mt-1 text-xl font-semibold md:text-2xl',
          muted && 'text-muted-foreground',
          tone === 'bad' && 'text-destructive',
          tone === 'good' && 'text-success',
        )}>
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </Card>
  );
}

function JarRow({ jar, status }: { jar: JarStatus; status: MonthStatus }) {
  const { icon: Icon, color } = JAR_STYLE[jar.key];
  const saving = jar.key === 'tiet_kiem';
  const ratio = jar.budget ? jar.spent / jar.budget : 0;
  const over = !saving && jar.budget > 0 && jar.spent > jar.budget;
  // Mốc "nên tiêu tới đâu" theo số ngày đã qua.
  const pace = status.daysInMonth ? status.daysPassed / status.daysInMonth : 0;
  const ahead = !saving && jar.budget > 0 && !over && ratio > pace + 0.1 && status.daysPassed < status.daysInMonth;
  return (
    <li>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="inline-flex items-center gap-2 font-medium">
          <Icon className="size-4" style={{ color }} aria-hidden />
          {jar.name}
        </span>
        <span className="num text-sm">
          {saving ? 'đang dư ' : ''}
          <b className={over ? 'text-destructive' : undefined}>{vndShort(jar.spent)}</b>
          <span className="text-muted-foreground"> / {jar.budget ? vndShort(jar.budget) : 'chưa đặt'}</span>
          {jar.budget ? <span className="text-muted-foreground"> · {Math.round(ratio * 100)}%</span> : null}
        </span>
      </div>
      <div
        className="relative h-2.5 rounded-full bg-muted"
        role="progressbar"
        aria-label={jar.name}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(ratio, 1) * 100)}>
        <div className="h-2.5 rounded-full" style={{ width: `${Math.min(ratio, 1) * 100}%`, background: over ? '#dc2626' : color }} />
        {!saving && jar.budget > 0 && status.daysPassed > 0 && status.daysPassed < status.daysInMonth ? (
          <div className="absolute -top-1 h-4.5 w-0.5 rounded bg-foreground/60" style={{ left: `${pace * 100}%` }} title="Mức nên tiêu tới hôm nay" />
        ) : null}
      </div>
      {over ? <p className="mt-1 text-xs font-medium text-destructive">Vượt {vnd(jar.spent - jar.budget)}</p> : null}
      {ahead ? <p className="mt-1 text-xs font-medium text-accent">Đang tiêu nhanh hơn số ngày đã qua ({Math.round(pace * 100)}% kỳ)</p> : null}
      {saving && jar.budget > 0 && status.saved !== null && status.saved < jar.budget ? (
        <p className="mt-1 text-xs text-muted-foreground">Còn thiếu {vnd(jar.budget - Math.max(0, status.saved))} so với mức muốn để dành</p>
      ) : null}
    </li>
  );
}

function ReviewCard({ period }: { period: string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setText(''), [period]);
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      setText((await api<{ text: string }>('/budget/review', { method: 'POST', body: { period } })).text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="lg:col-span-2">
      <CardTitle
        extra={
          <Button variant="outline" onClick={run} loading={busy}>
            <Sparkles className="size-4" aria-hidden /> {text ? 'Đánh giá lại' : 'AI đánh giá'}
          </Button>
        }>
        Nhận xét
      </CardTitle>
      {error ? <ErrorBox message={error} /> : null}
      {text ? (
        <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800">{text}</p>
      ) : (
        <p className="text-sm text-muted-foreground">AI xem các hũ, số ngày đã qua và các khoản lớn để chỉ ra hũ nào đang vượt, nên cắt gì.</p>
      )}
    </Card>
  );
}

function IncomeCard({ status, onChanged }: { status: MonthStatus; onChanged: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('Lương');
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = parseMoney(amount);
    if (!value) return toast('Số tiền không hợp lệ', 'error');
    setBusy(true);
    try {
      const result = await api<{ started?: unknown }>('/incomes', { method: 'POST', body: { amount: value, note, received: !later } });
      setAmount('');
      toast(later ? 'Đã ghi lương chờ nhận' : result?.started ? 'Đã cộng lương, bắt đầu tháng mới từ hôm nay' : 'Đã thêm thu nhập');
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: number) => {
    try {
      await api(`/incomes/${id}`, { method: 'DELETE' });
      toast('Đã xóa');
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <Card>
      <CardTitle>Thu nhập · {status.period.label}</CardTitle>
      {status.incomes.length ? (
        <ul className="mb-4 divide-y divide-border rounded-lg border border-border">
          {status.incomes.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>{i.note || 'Lương'}</span>
              <span className="flex items-center gap-2">
                <span className="num font-semibold">{vnd(i.amount)}</span>
                <button onClick={() => remove(i.id)} className="rounded-md p-2 text-muted-foreground hover:bg-red-50 hover:text-destructive" aria-label={`Xóa ${i.note ?? ''}`}>
                  <Trash2 className="size-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">Chưa có. Trên bot gõ <code>/luong 25tr</code> hoặc thêm ở đây.</p>
      )}
      {status.pending.length ? (
        <ul className="mb-4 divide-y divide-border rounded-lg border border-dashed border-emerald-300 bg-emerald-50/50">
          {status.pending.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>
                {i.note || 'Lương'} <span className="text-xs text-emerald-800">· chờ nhận</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="num font-semibold">{vnd(i.amount)}</span>
                <button onClick={() => remove(i.id)} className="rounded-md p-2 text-muted-foreground hover:bg-red-50 hover:text-destructive" aria-label={`Xóa ${i.note ?? ''}`}>
                  <Trash2 className="size-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
        <MoneyField label="Số tiền" value={amount} onChange={setAmount} required />
        <Field label="Ghi chú">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={60} />}</Field>
        <Button type="submit" loading={busy} className="sm:mt-[26px]">
          <Plus className="size-4" aria-hidden /> Thêm
        </Button>
        <label className="flex items-start gap-2 text-sm sm:col-span-3">
          <input type="checkbox" className="mt-1 size-4 accent-primary" checked={later} onChange={(e) => setLater(e.target.checked)} />
          <span>Chưa về, ghi trước (chờ nhận). Không chọn: cộng ngay vào số dư; nếu là lương thì hôm nay thành đầu tháng mới.</span>
        </label>
      </form>
    </Card>
  );
}

function SplitCard({ status, onSaved }: { status: MonthStatus; onSaved: () => void }) {
  const toast = useToast();
  const initial = () => Object.fromEntries(status.jars.map((j) => [j.key, moneyText(j.budget)])) as Record<JarKey, string>;
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setValues(initial()), [status]);

  const parsed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim() ? parseMoney(v) : 0])) as Record<JarKey, number | null>;
  const invalid = Object.values(parsed).some((v) => v === null);
  const sum = Object.values(parsed).reduce<number>((s, v) => s + (v ?? 0), 0);
  const diff = status.income - sum;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (invalid) return toast('Có ô số tiền không hợp lệ', 'error');
    setBusy(true);
    try {
      await api('/jars', { method: 'PUT', body: parsed });
      toast('Đã lưu cách chia hũ');
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle>Chia lương vào hũ</CardTitle>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {status.jars.map((j) => {
            const value = parsed[j.key];
            const share = status.income && value ? ` · ${Math.round((value / status.income) * 100)}% lương` : '';
            return (
              <MoneyField
                key={j.key}
                label={j.name}
                value={values[j.key]}
                onChange={(v) => setValues({ ...values, [j.key]: v })}
                hint={value ? `${vnd(value)}${share}` : 'Mỗi tháng'}
              />
            );
          })}
        </div>
        <p className={cx('rounded-lg px-3 py-2 text-sm', !status.income ? 'bg-muted' : diff < 0 ? 'bg-red-50 text-red-800' : diff > 0 ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900')}>
          Tổng các hũ <b className="num">{vnd(sum)}</b>
          {!status.income
            ? ' · tháng này chưa nhập lương'
            : diff < 0
              ? ` · vượt lương ${vnd(-diff)}`
              : diff > 0
                ? ` · còn ${vnd(diff)} chưa chia`
                : ' · vừa đủ lương'}
        </p>
        <p className="text-xs text-muted-foreground">Cách chia dùng chung cho mọi tháng.</p>
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={invalid}>
            Lưu
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MappingCard({ data, onSaved }: { data: BudgetData; onSaved: () => void }) {
  const toast = useToast();
  const spendJars = data.jars.filter((j) => j.key !== 'tiet_kiem');
  const totals = new Map(data.status.byCategory.map((c) => [c.category, c.total]));
  const change = async (category: string, jar: string) => {
    try {
      await api('/category-jars', { method: 'PUT', body: { [category]: jar } });
      toast(`${category} → ${spendJars.find((j) => j.key === jar)?.name}`);
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <Card>
      <CardTitle>Danh mục thuộc hũ nào</CardTitle>
      <ul className="grid gap-x-8 gap-y-2 md:grid-cols-2">
        {data.categories.map((c) => (
          <li key={c} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
              <CategoryBadge category={c} />
              {totals.get(c) ? <span className="num text-xs text-muted-foreground">{vndShort(totals.get(c)!)}</span> : null}
            </span>
            <div className="w-40 shrink-0 sm:w-48">
              <Select value={data.mapping[c] ?? 'tieu_xai'} onChange={(e) => change(c, e.target.value)} aria-label={`Hũ của ${c}`}>
                {spendJars.map((j) => (
                  <option key={j.key} value={j.key}>
                    {j.key === 'bat_buoc' ? 'Bắt buộc' : j.name}
                  </option>
                ))}
              </Select>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

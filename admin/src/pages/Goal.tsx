import { CheckCircle2, CircleAlert, RefreshCw, Sparkles, Target, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { MoneyField } from '../components/MoneyField';
import { Button, Card, CardTitle, CategoryBadge, cx, EmptyState, ErrorBox, Field, Input, Modal, Spinner, useToast } from '../components/ui';
import { api, type GoalPlan, type GoalView } from '../lib/api';
import { addMonths, JAR_STYLE, monthLabel, parseMoney, todayVn, vnd, vndShort } from '../lib/format';
import { useApi } from '../lib/use-api';

export default function GoalPage() {
  const toast = useToast();
  const view = useApi(() => api<GoalView>('/goal'), 'goal');
  const [data, setData] = useState<GoalView | null>(null);
  const [modal, setModal] = useState<'new' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = data ?? view.data;

  const replan = async () => {
    setBusy(true);
    try {
      setData(await api<GoalView>('/goal/plan', { method: 'POST' }));
      toast('Đã lập lại kế hoạch');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api('/goal', { method: 'DELETE' });
      setData({ goal: null });
      setModal(null);
      toast('Đã bỏ mục tiêu');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (view.error) return <ErrorBox message={view.error} onRetry={view.reload} />;
  if (!shown) return <Spinner />;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Mục tiêu tiết kiệm</h1>
          <p className="text-sm text-muted-foreground">AI lập kế hoạch chi tiêu mỗi tháng: giữ khoản nào, cắt khoản nào</p>
        </div>
        {shown.goal ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={replan} loading={busy}>
              <RefreshCw className="size-4" aria-hidden /> Lập lại kế hoạch
            </Button>
            <Button variant="outline" onClick={() => setModal('new')}>
              <Target className="size-4" aria-hidden /> Mục tiêu mới
            </Button>
            <Button variant="outline" onClick={() => setModal('delete')} className="text-destructive">
              <Trash2 className="size-4" aria-hidden /> Bỏ
            </Button>
          </div>
        ) : null}
      </header>

      {shown.goal ? (
        <GoalBody view={shown} />
      ) : (
        <Card className="max-w-2xl">
          <EmptyState title="Chưa có mục tiêu" desc="Đặt số tiền muốn có và thời hạn, AI sẽ dựa vào lương và chi tiêu thật của bạn để lập kế hoạch." />
          <GoalForm onCreated={setData} />
        </Card>
      )}

      <Modal open={modal === 'new'} title="Đặt mục tiêu mới" onClose={() => setModal(null)}>
        <p className="mb-4 text-sm text-muted-foreground">Mục tiêu hiện tại sẽ được thay bằng mục tiêu mới.</p>
        <GoalForm
          onCreated={(v) => {
            setData(v);
            setModal(null);
          }}
        />
      </Modal>
      <Modal open={modal === 'delete'} title="Bỏ mục tiêu?" onClose={() => setModal(null)}>
        <p>
          Bỏ mục tiêu <b>{shown.goal?.title}</b>? Dữ liệu chi tiêu và lương vẫn giữ nguyên.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setModal(null)}>
            Hủy
          </Button>
          <Button variant="danger" loading={busy} onClick={remove}>
            Bỏ mục tiêu
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function GoalForm({ onCreated }: { onCreated: (v: GoalView) => void }) {
  const thisMonth = todayVn().slice(0, 7);
  const [form, setForm] = useState({ title: '', target: '', deadline: addMonths(thisMonth, 4), saved: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const target = parseMoney(form.target);
    const saved = form.saved.trim() ? parseMoney(form.saved) : 0;
    if (!target) return setError('Nhập số tiền mục tiêu');
    if (saved === null) return setError('Số tiền đã có không hợp lệ');
    setBusy(true);
    setError('');
    try {
      onCreated(await api<GoalView>('/goal', { method: 'POST', body: { title: form.title, target, deadline: form.deadline, saved_before: saved } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Để làm gì">{(id) => <Input id={id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Mua laptop, quỹ dự phòng…" maxLength={80} />}</Field>
      </div>
      <MoneyField label="Số tiền muốn có" value={form.target} onChange={(v) => setForm({ ...form, target: v })} required placeholder="VD 50tr" />
      <Field label="Hoàn thành trước hết tháng">
        {(id) => <Input id={id} type="month" min={thisMonth} value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} required />}
      </Field>
      <MoneyField label="Đã có sẵn (nếu có)" value={form.saved} onChange={(v) => setForm({ ...form, saved: v })} placeholder="VD 10tr" hint="Bỏ trống nếu bắt đầu từ 0" />
      {error ? (
        <div className="sm:col-span-2">
          <ErrorBox message={error} />
        </div>
      ) : null}
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" loading={busy}>
          <Sparkles className="size-4" aria-hidden /> {busy ? 'AI đang lập kế hoạch…' : 'Đặt mục tiêu & lập kế hoạch'}
        </Button>
      </div>
    </form>
  );
}

function GoalBody({ view }: { view: GoalView }) {
  const goal = view.goal!;
  const p = view.progress!;
  const reached = p.saved >= goal.target;
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Mục tiêu</p>
            <p className="text-xl font-semibold">{goal.title}</p>
            <p className="text-sm text-muted-foreground">
              {vnd(goal.target)} trước hết tháng {monthLabel(goal.deadline)}
            </p>
          </div>
          <p className="num text-right text-2xl font-semibold text-success">
            {vndShort(p.saved)} <span className="text-base font-normal text-muted-foreground">/ {vndShort(goal.target)}</span>
          </p>
        </div>
        <div className="mt-3 h-3 rounded-full bg-muted" role="progressbar" aria-label="Tiến độ" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent}>
          <div className="h-3 rounded-full bg-success" style={{ width: `${p.percent}%` }} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Đã để dành" value={`${p.percent}%`} />
          <Stat label="Còn lại" value={p.monthsLeft > 0 ? `${p.monthsLeft} tháng` : 'Hết hạn'} />
          <Stat label="Từ giờ mỗi tháng cần" value={reached ? 'Đã đủ' : vndShort(p.needFromNow)} />
          <Stat label="Chia đều từ đầu" value={`${vndShort(p.needPerMonth)}/tháng`} />
        </div>
        {p.missingIncome.length ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            Chưa nhập lương tháng {p.missingIncome.map(monthLabel).join(', ')} nên chưa tính tiền để dành của tháng đó (trang Ngân sách hoặc /luong trên bot).
          </p>
        ) : null}
      </Card>

      {view.planError ? <ErrorBox message={view.planError} /> : null}
      {view.plan ? <PlanCard plan={view.plan} /> : !view.planError ? <Card><p className="text-sm text-muted-foreground">Chưa có kế hoạch. Bấm “Lập lại kế hoạch”.</p></Card> : null}

      <Card className="p-0">
        <div className="px-4 pt-4 md:px-5">
          <CardTitle>Từng tháng</CardTitle>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium md:px-5">Tháng</th>
              <th className="px-4 py-2 text-right font-medium">Thu nhập</th>
              <th className="px-4 py-2 text-right font-medium">Đã chi</th>
              <th className="px-4 py-2 text-right font-medium md:px-5">Để dành</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {goal.saved_before > 0 ? (
              <tr>
                <td className="px-4 py-2 md:px-5">Có sẵn</td>
                <td colSpan={2} />
                <td className="num px-4 py-2 text-right font-semibold md:px-5">{vndShort(goal.saved_before)}</td>
              </tr>
            ) : null}
            {p.months.map((m) => (
              <tr key={m.month}>
                <td className="num px-4 py-2 md:px-5">{monthLabel(m.month)}</td>
                <td className="num px-4 py-2 text-right">{m.income ? vndShort(m.income) : '—'}</td>
                <td className="num px-4 py-2 text-right">{vndShort(m.spent)}</td>
                <td className={cx('num px-4 py-2 text-right font-semibold md:px-5', m.saved !== null && m.saved < 0 && 'text-destructive')}>
                  {m.saved === null ? <span className="font-normal text-muted-foreground">chưa có lương</span> : vndShort(m.saved)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="num font-semibold">{value}</p>
    </div>
  );
}

const JAR_NAME: Record<string, string> = { bat_buoc: 'Bắt buộc', tieu_xai: 'Tiêu xài', game: 'Nạp game', tiet_kiem: 'Tiết kiệm' };

const ACTION_STYLE = {
  giữ: 'bg-slate-100 text-slate-700',
  giảm: 'bg-amber-100 text-amber-900',
  cắt: 'bg-red-100 text-red-800',
};

function PlanCard({ plan }: { plan: GoalPlan }) {
  const enough = plan.plannedSaving >= plan.need;
  return (
    <Card className="p-0">
      <div className="px-4 pt-4 md:px-5">
        <CardTitle extra={<span className="text-xs text-muted-foreground">{plan.source === 'ai' ? 'AI lập' : 'Lập theo quy tắc (AI lỗi)'}</span>}>Kế hoạch mỗi tháng</CardTitle>
        {plan.summary ? <p className="mb-3 text-sm leading-relaxed">{plan.summary}</p> : null}
        <div
          className={cx(
            'mb-4 flex items-start gap-2 rounded-lg px-3 py-2 text-sm',
            enough ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800',
          )}>
          {enough ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <span>
            Lương TB <b className="num">{vndShort(plan.income)}</b> − kế hoạch chi <b className="num">{vndShort(plan.plannedSpend)}</b> (
            {plan.dataDays >= 30 ? 'trung bình đang chi' : 'đã chi tới giờ'} <span className="num">{vndShort(plan.currentSpend)}</span>) = để dành{' '}
            <b className="num">{vndShort(plan.plannedSaving)}</b>/tháng.{' '}
            {enough ? `Đủ mức cần ${vndShort(plan.need)}.` : `Còn thiếu ${vndShort(plan.need - plan.plannedSaving)} so với mức cần ${vndShort(plan.need)}.`}
          </span>
        </div>
      </div>

      {plan.budgets.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground md:px-5">Chưa có dữ liệu chi tiêu để đề xuất cắt giảm.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {plan.budgets.map((b) => {
            const jar = JAR_STYLE[b.jar];
            return (
              <li key={b.category} className="grid gap-1 px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_auto_minmax(0,2fr)] md:items-center md:gap-4 md:px-5">
                <div className="flex items-center justify-between gap-2 md:justify-start">
                  <CategoryBadge category={b.category} />
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground md:hidden">
                    <jar.icon className="size-3.5" style={{ color: jar.color }} aria-hidden />
                    {JAR_NAME[b.jar]}
                  </span>
                </div>
                <div className="num flex items-center gap-2 text-sm">
                  {b.action !== 'giữ' ? <span className="text-muted-foreground line-through">{vndShort(b.current)}</span> : null}
                  <b>{vndShort(b.target)}</b>
                  <span className={cx('rounded-md px-2 py-0.5 font-sans text-xs font-semibold', ACTION_STYLE[b.action])}>{b.action}</span>
                </div>
                <p className="text-sm text-muted-foreground">{b.reason}</p>
              </li>
            );
          })}
        </ul>
      )}

      {plan.tips.length ? (
        <div className="border-t border-border px-4 py-3 md:px-5">
          <p className="mb-1 text-sm font-semibold">Mẹo</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {plan.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {plan.dataDays < 30 ? (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground md:px-5">
          Mới có {plan.dataDays} ngày dữ liệu chi tiêu nên kế hoạch còn ước lượng. Ghi thêm rồi bấm “Lập lại kế hoạch”.
        </p>
      ) : null}
    </Card>
  );
}

import { Banknote } from 'lucide-react';
import { useState } from 'react';

import { MoneyField } from '../components/MoneyField';
import { Button, Modal, useToast } from '../components/ui';
import { api, type SalaryState } from '../lib/api';
import { dayLabel, parseMoney, vnd, vndShort } from '../lib/format';
import { useApi } from '../lib/use-api';

type Received = { amount: number; started: { from: string; to: string } | null } | null;

/**
 * Nút "+lương": hiện khi có lương chờ nhận, hoặc đã tới ngày lương mà chưa ghi.
 * Bấm = cộng vào số dư và bắt đầu tháng mới từ hôm nay (không có nút "bắt đầu tháng" riêng).
 */
export function SalaryBanner({ onReceived }: { onReceived: () => void }) {
  const toast = useToast();
  const state = useApi(() => api<SalaryState>('/salary'), 'salary');
  const [busy, setBusy] = useState<string | null>(null);
  const [other, setOther] = useState(false);
  const [amount, setAmount] = useState('');

  const done = (r: Received) => {
    toast(r?.started ? `Đã cộng +${vndShort(r.amount)}, bắt đầu tháng mới từ hôm nay` : `Đã cộng +${vndShort(r?.amount ?? 0)}`);
    setOther(false);
    state.reload();
    onReceived();
  };
  const receive = async (key: string, run: () => Promise<Received>) => {
    setBusy(key);
    try {
      done(await run());
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const s = state.data;
  if (!s || (!s.pending.length && !s.due)) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-success text-white">
          <Banknote className="size-5" aria-hidden />
        </span>
        <div>
          <p className="font-semibold">{s.pending.length ? 'Lương đang chờ nhận' : 'Đã tới ngày lương'}</p>
          <p className="text-sm">Lương về tài khoản rồi thì bấm nhận: cộng vào số dư và hôm nay ({dayLabel(new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10))}) là đầu tháng mới.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {s.pending.map((p) => (
          <Button key={p.id} variant="primary" className="bg-success hover:bg-success/90" loading={busy === `p${p.id}`} onClick={() => receive(`p${p.id}`, () => api<Received>(`/incomes/${p.id}/receive`, { method: 'POST' }))}>
            +{vndShort(p.amount)} {p.note && p.note !== 'Lương' ? `(${p.note})` : ''}
          </Button>
        ))}
        {s.due ? (
          <Button variant="primary" className="bg-success hover:bg-success/90" loading={busy === 'due'} onClick={() => receive('due', () => api<Received>('/incomes', { method: 'POST', body: { amount: s.due!.amount, note: 'Lương' } }))}>
            +{vndShort(s.due.amount)} lương
          </Button>
        ) : null}
        <Button variant="outline" className="bg-white" onClick={() => setOther(true)}>
          Số khác
        </Button>
      </div>

      <Modal open={other} title="Nhận lương" onClose={() => setOther(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const value = parseMoney(amount);
            if (!value) return toast('Số tiền không hợp lệ', 'error');
            receive('other', async () => {
              // Có lương chờ với số khác: bỏ khoản chờ cũ, ghi số thật.
              for (const p of s.pending) await api(`/incomes/${p.id}`, { method: 'DELETE' });
              return api<Received>('/incomes', { method: 'POST', body: { amount: value, note: 'Lương' } });
            });
          }}>
          <MoneyField label="Lương thực nhận" value={amount} onChange={setAmount} required placeholder={s.average ? vndShort(s.average) : 'VD 25tr'} hint={s.average ? `Trung bình: ${vnd(s.average)}` : undefined} />
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">Cộng vào số dư và bắt đầu tháng mới từ hôm nay. {s.pending.length ? 'Khoản lương đang chờ sẽ được thay bằng số này.' : ''}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOther(false)}>
              Hủy
            </Button>
            <Button type="submit" loading={busy === 'other'}>
              Nhận lương
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

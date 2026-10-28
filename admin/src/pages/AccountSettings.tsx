import { CheckCircle2, ExternalLink, KeyRound, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Button, Card, CardTitle, ErrorBox, Field, Input, Modal, Spinner, useToast } from '../components/ui';
import { api, setToken } from '../lib/api';
import { useApi } from '../lib/use-api';

type Account = { username: string; chat_id: number | null; pending_chat_id: number | null; bot_username: string | null };

export function useAccount() {
  return useApi(() => api<Account>('/account'), 'account');
}

/** Liên kết Telegram: nhập ID -> bot gửi mã 6 số vào chat đó -> nhập mã. Xác minh để không ai liên kết được Telegram của người khác. */
export function TelegramLinkCard({ account, reload }: { account: Account; reload: () => void }) {
  const toast = useToast();
  const [chatId, setChatId] = useState(account.pending_chat_id ? String(account.pending_chat_id) : '');
  const [step, setStep] = useState<'id' | 'code'>(account.pending_chat_id ? 'code' : 'id');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmUnlink, setConfirmUnlink] = useState(false);

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
  const sendCode = (e?: FormEvent) => {
    e?.preventDefault();
    run(async () => {
      await api('/account/link/start', { method: 'POST', body: { chat_id: chatId.trim() } });
      setStep('code');
      setCode('');
      toast('Bot đã gửi mã vào Telegram của bạn');
    });
  };
  const confirm = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/account/link/confirm', { method: 'POST', body: { code } });
      toast('Đã liên kết Telegram');
      reload();
    });
  };
  const doUnlink = () =>
    run(async () => {
      await api('/account/unlink', { method: 'POST' });
      setConfirmUnlink(false);
      setStep('id');
      toast('Đã hủy liên kết');
      reload();
    });

  return (
    <Card>
      <CardTitle>Liên kết Telegram</CardTitle>
      {account.chat_id ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-5 text-success" aria-hidden />
            <span>
              Đã liên kết với ID <b className="num">{account.chat_id}</b>. Tin nhắn ghi chi tiêu trên bot sẽ hiện ở đây.
            </span>
          </p>
          <Button variant="outline" onClick={() => setConfirmUnlink(true)} className="text-destructive">
            Hủy liên kết
          </Button>
        </div>
      ) : step === 'id' ? (
        <form onSubmit={sendCode} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="ID Telegram của bạn" hint="Mở bot, bấm Start: bot sẽ trả lời kèm ID (một dãy số). Xem hướng dẫn bên dưới.">
              {(id) => <Input id={id} inputMode="numeric" value={chatId} onChange={(e) => setChatId(e.target.value.replace(/\D/g, ''))} required placeholder="VD 1234567890" className="num" />}
            </Field>
          </div>
          <Button type="submit" loading={busy} disabled={!chatId} className="sm:mb-[22px]">
            <Send className="size-4" aria-hidden /> Gửi mã
          </Button>
        </form>
      ) : (
        <form onSubmit={confirm} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Bot đã gửi mã 6 số tới Telegram ID <b className="num text-foreground">{chatId}</b>. Mã dùng được 10 phút.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Mã xác minh">
                {(id) => (
                  <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required className="num tracking-[0.3em]" autoFocus />
                )}
              </Field>
            </div>
            <Button type="submit" loading={busy} disabled={code.length !== 6}>
              Xác nhận
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => sendCode()} disabled={busy}>
              Gửi lại mã
            </button>
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => setStep('id')}>
              Nhập ID khác
            </button>
          </div>
        </form>
      )}
      {error ? (
        <div className="mt-3">
          <ErrorBox message={error} />
        </div>
      ) : null}
      <Modal open={confirmUnlink} title="Hủy liên kết Telegram?" onClose={() => setConfirmUnlink(false)}>
        <p>Dữ liệu vẫn nằm trong tài khoản này, nhưng bot sẽ không nhận tin nhắn từ Telegram đó nữa cho tới khi liên kết lại.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmUnlink(false)}>
            Giữ liên kết
          </Button>
          <Button variant="danger" loading={busy} onClick={doUnlink}>
            Hủy liên kết
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

export function PasswordCard({ username }: { username: string }) {
  const toast = useToast();
  const [form, setForm] = useState({ current: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) return setError('Hai lần nhập mật khẩu mới không khớp');
    setBusy(true);
    setError('');
    try {
      const { token } = await api<{ token: string }>('/account/password', { method: 'POST', body: form });
      setToken(token);
      setForm({ current: '', password: '', confirm: '' });
      toast('Đã đổi mật khẩu, các thiết bị khác sẽ phải đăng nhập lại');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardTitle>
        <span className="inline-flex items-center gap-2">
          <KeyRound className="size-4 text-primary" aria-hidden /> Tài khoản <span className="font-normal text-muted-foreground">· {username}</span>
        </span>
      </CardTitle>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <input type="text" autoComplete="username" value={username} readOnly hidden />
        <Field label="Mật khẩu hiện tại">
          {(id) => <Input id={id} type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} required />}
        </Field>
        <Field label="Mật khẩu mới">
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />}
        </Field>
        <Field label="Nhập lại mật khẩu mới">
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required />}
        </Field>
        {error ? (
          <div className="sm:col-span-3">
            <ErrorBox message={error} />
          </div>
        ) : null}
        <div className="flex justify-end sm:col-span-3">
          <Button type="submit" loading={busy}>
            Đổi mật khẩu
          </Button>
        </div>
      </form>
    </Card>
  );
}

const GUIDE: { group: string; rows: [string, string][] }[] = [
  {
    group: 'Ghi chi tiêu',
    rows: [
      ['phở 45k, grab 60k', 'Ghi 2 khoản, AI tự chọn danh mục'],
      ['hôm qua cafe 35k', 'Ghi vào ngày hôm qua'],
      ['lẩu 300k ở Đà Lạt', 'Có nơi chốn khác thành phố nhà: tự gom thành chuyến du lịch'],
      ['(gửi ảnh hóa đơn / chuyển khoản)', 'Bot đọc số tiền và ngày trên ảnh; ghi chú "tách" để tách từng món'],
      ['td phở 45k', 'Quẹt thẻ tín dụng: trừ vào ngày 1 tháng sau'],
      ['(reply tin bot) 60k / ăn uống / hôm qua / xóa', 'Sửa nhanh khoản vừa ghi'],
      ['/xoa', 'Xóa khoản vừa ghi'],
    ],
  },
  {
    group: 'Lương, hũ, số dư',
    rows: [
      ['/luong 25tr', 'Ghi lương tháng này (về ngày 27, đổi bằng /ngayluong)'],
      ['/chiahu 10tr 6tr 1tr 8tr', 'Chia lương vào 4 hũ: bắt buộc, tiêu xài, nạp game, tiết kiệm'],
      ['/hu · /danhgia', 'Xem các hũ · AI nhận xét tháng này'],
      ['/sodu 15tr · /sodu', 'Nhập tiền đang có · xem cuối tháng, tháng sau còn bao nhiêu'],
      ['/codinh tiền nhà 5tr ngày 5', 'Khoản cố định hằng tháng, tự trừ đúng ngày'],
      ['/muctieu 50tr tới tháng 2 năm sau', 'Mục tiêu tiết kiệm, AI lập kế hoạch cắt giảm'],
    ],
  },
  {
    group: 'Báo cáo & khác',
    rows: [
      ['/homnay · /tuan · /thang', 'Tổng chi theo kỳ'],
      ['/tongket · /tongket 10', 'Tổng kết tháng trước / tháng 10 (ngày 1 hằng tháng bot tự gửi)'],
      ['/dulich Đà Lạt · /venha · /chuyendi', 'Bật / tắt chế độ du lịch · xem các chuyến'],
      ['/hoi tháng này cà phê hết bao nhiêu?', 'Hỏi AI về chi tiêu'],
      ['/nhac tat', 'Tắt nhắc ghi chi tiêu lúc 21h'],
    ],
  },
];

export function BotGuideCard({ botUsername }: { botUsername: string | null }) {
  const link = botUsername ? `https://t.me/${botUsername}` : null;
  return (
    <Card>
      <CardTitle>Hướng dẫn dùng bot Telegram</CardTitle>
      <ol className="mb-4 flex flex-col gap-2 text-sm">
        {[
          <>
            Mở bot{' '}
            {link ? (
              <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                @{botUsername} <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : (
              'Chi Tiêu'
            )}{' '}
            trên Telegram và bấm <b>Start</b>. Bot trả lời kèm <b>ID Telegram</b> của bạn.
          </>,
          <>Nhập ID đó vào ô <b>Liên kết Telegram</b> ở trên, bấm <b>Gửi mã</b>.</>,
          <>Bot gửi mã 6 số vào Telegram. Nhập mã, bấm <b>Xác nhận</b>.</>,
          <>Xong! Nhắn chi tiêu cho bot như bảng dưới, trang này cập nhật ngay.</>,
        ].map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-white">{i + 1}</span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-background text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Bạn nhắn</th>
              <th className="px-3 py-2 font-medium">Bot làm gì</th>
            </tr>
          </thead>
          {GUIDE.map((g) => (
            <tbody key={g.group} className="divide-y divide-border border-t border-border">
              <tr>
                <th colSpan={2} className="bg-muted/60 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground">
                  {g.group}
                </th>
              </tr>
              {g.rows.map(([say, does]) => (
                <tr key={say}>
                  <td className="px-3 py-2 align-top">
                    <code className="whitespace-nowrap rounded bg-background px-1.5 py-0.5 font-mono text-[13px]">{say}</code>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{does}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Gõ /help trên bot để xem đầy đủ.</p>
    </Card>
  );
}

export function AccountSection() {
  const account = useAccount();
  if (account.error) return <ErrorBox message={account.error} onRetry={account.reload} />;
  if (!account.data) return <Spinner />;
  return (
    <>
      <TelegramLinkCard account={account.data} reload={account.reload} />
      <BotGuideCard botUsername={account.data.bot_username} />
      <PasswordCard username={account.data.username} />
    </>
  );
}

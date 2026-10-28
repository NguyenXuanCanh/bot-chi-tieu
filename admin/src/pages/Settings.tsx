import { Download, LogOut } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { Button, Card, CardTitle, ErrorBox, Field, Input, Spinner, useToast } from '../components/ui';
import { api, downloadCsv } from '../lib/api';
import { useApi } from '../lib/use-api';
import { AccountSection } from './AccountSettings';

export default function SettingsPage({ onLogout }: { onLogout: () => void }) {
  const toast = useToast();
  const settings = useApi(() => api<{ home_city: string; payday: number }>('/settings'), 'settings');
  const [home, setHome] = useState('');
  const [payday, setPayday] = useState('27');
  const [busy, setBusy] = useState<'save' | 'export' | 'payday' | null>(null);

  useEffect(() => {
    if (settings.data) {
      setHome(settings.data.home_city);
      setPayday(String(settings.data.payday));
    }
  }, [settings.data]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    try {
      await api('/settings', { method: 'PATCH', body: { home_city: home } });
      toast('Đã lưu thành phố nhà');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const savePayday = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('payday');
    try {
      await api('/settings', { method: 'PATCH', body: { payday: Number(payday) } });
      toast(`Lương về ngày ${payday} hằng tháng`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async () => {
    setBusy('export');
    try {
      await downloadCsv();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Cài đặt</h1>
      <AccountSection />
      <Card>
        <CardTitle>Thành phố nhà</CardTitle>
        {settings.error ? <ErrorBox message={settings.error} onRetry={settings.reload} /> : null}
        {!settings.data && settings.loading ? (
          <Spinner />
        ) : (
          <form onSubmit={save} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Chi tiêu ghi ở thành phố này không tính là du lịch" hint="Giống lệnh /nha trên bot.">
                {(id) => <Input id={id} value={home} onChange={(e) => setHome(e.target.value)} required maxLength={60} />}
              </Field>
            </div>
            <Button type="submit" loading={busy === 'save'}>
              Lưu
            </Button>
          </form>
        )}
      </Card>
      <Card>
        <CardTitle>Ngày nhận lương</CardTitle>
        {settings.data ? (
          <form onSubmit={savePayday} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Lương về ngày (hằng tháng)" hint="VD 27: lương tháng 10 về ngày 27/10. Lương nhập trước ngày này chỉ cộng vào số dư khi tới ngày. Trên bot: /ngayluong">
                {(id) => <Input id={id} type="number" min={1} max={28} value={payday} onChange={(e) => setPayday(e.target.value)} required className="num sm:w-32" />}
              </Field>
            </div>
            <Button type="submit" loading={busy === 'payday'}>
              Lưu
            </Button>
          </form>
        ) : null}
      </Card>
      <Card>
        <CardTitle>Dữ liệu</CardTitle>
        <p className="mb-3 text-sm text-muted-foreground">Tải toàn bộ chi tiêu ra file CSV (mở được bằng Excel / Google Sheets).</p>
        <Button variant="outline" onClick={exportCsv} loading={busy === 'export'}>
          <Download className="size-4" aria-hidden /> Xuất CSV
        </Button>
      </Card>
      <Card>
        <CardTitle>Phiên đăng nhập</CardTitle>
        <Button variant="outline" onClick={onLogout}>
          <LogOut className="size-4" aria-hidden /> Đăng xuất
        </Button>
      </Card>
    </div>
  );
}

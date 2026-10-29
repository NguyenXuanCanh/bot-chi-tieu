import { CheckCircle2, Download, Share, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, Card, CardTitle, useToast } from '../components/ui';
import { canPrompt, isIos, isStandalone, onInstallChange, promptInstall } from '../lib/install';

/** Cài trang lên điện thoại / máy tính như một app (icon ngoài màn hình chính, mở toàn màn hình). */
export function InstallCard() {
  const toast = useToast();
  const [ready, setReady] = useState(canPrompt());
  useEffect(() => onInstallChange(() => setReady(canPrompt())), []);

  if (isStandalone()) {
    return (
      <Card>
        <CardTitle>Cài app</CardTitle>
        <p className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="size-5 text-success" aria-hidden /> Bạn đang dùng bản đã cài.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <CardTitle>
        <span className="inline-flex items-center gap-2">
          <Smartphone className="size-4 text-primary" aria-hidden /> Cài app lên điện thoại
        </span>
      </CardTitle>
      <p className="mb-3 text-sm text-muted-foreground">
        Có icon ngoài màn hình chính, mở toàn màn hình như app. Nhấn giữ icon để <b>Thêm khoản chi</b> nhanh.
      </p>
      {ready ? (
        <Button
          onClick={async () => {
            if (await promptInstall()) toast('Đã cài app');
          }}>
          <Download className="size-4" aria-hidden /> Cài app
        </Button>
      ) : isIos() ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Mở trang này bằng <b>Safari</b>.</li>
          <li>
            Bấm nút <Share className="inline size-4 align-text-bottom" aria-label="Chia sẻ" /> <b>Chia sẻ</b> ở thanh dưới.
          </li>
          <li>
            Chọn <b>Thêm vào MH chính</b> (Add to Home Screen) → <b>Thêm</b>.
          </li>
        </ol>
      ) : (
        <p className="text-sm">
          Trên Chrome / Edge: mở menu <b>⋮</b> → <b>Cài đặt ứng dụng</b> (hoặc <b>Thêm vào màn hình chính</b>).
        </p>
      )}
    </Card>
  );
}

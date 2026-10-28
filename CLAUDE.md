# Chi Tiêu Bot: hướng dẫn cho Claude

Đọc [HANDOVER.md](HANDOVER.md) trước: kiến trúc, bảng dữ liệu, cấu hình, deploy, vận hành, việc còn dở.
Dưới đây là quy ước và các điểm dễ sai khi sửa code.

## Ngôn ngữ

- Trả lời người dùng bằng tiếng Việt. Chữ trong bot và trang quản lý: tiếng Việt. Comment code: tiếng Việt, ngắn, giải thích "vì sao".
- Commit message: tiếng Anh.

## Lệnh

```bash
npm test                          # test hàm thuần trong src/core.ts (test/core.test.ts)
npx tsc --noEmit                  # kiểu backend
cd admin && npx tsc -b            # kiểu frontend (npm run build cũng chạy)
npm run db:remote                 # chỉ khi schema.sql có bảng / chỉ mục mới
npm run db:migrate                # khi scripts/migrate.mjs có câu mới: chạy TRƯỚC deploy
npm run deploy                    # build admin + wrangler deploy
```

Không chạy `npm run setup` trên bản cài đã chạy ổn trừ khi cần (nó sinh webhook secret mới và hỏi lại token).

## Quy tắc dữ liệu

- Mọi truy vấn lọc theo `chat_id` của người đang dùng; sửa/xóa theo id luôn kèm `AND chat_id = ?`.
- Thêm bảng có `chat_id` thì thêm vào `DATA_TABLES` / `KEYED_TABLES` trong `src/accounts.ts` (chuyển dữ liệu khi liên kết Telegram).
- Bảng mới: `CREATE TABLE IF NOT EXISTS` trong `schema.sql`. Thêm cột vào bảng cũ: câu `ALTER` trong `scripts/migrate.mjs`
  **và** sửa `CREATE TABLE` trong `schema.sql`.
- Ngày lưu `YYYY-MM-DD` giờ VN: dùng `vnDate()`; tiền là số nguyên VND, hiển thị bằng `formatVnd` / `formatVndFull`.
- Ngân sách tính theo **kỳ** (từ lần bấm nhận lương tới trước lần sau; chưa có thì tháng lịch): dùng `periodFor` +
  `periodStatus` (`src/period.ts`, `src/budget.ts`). `monthStatus` chỉ cho tổng kết tháng lịch.
- Lương: `incomes.received_at` NULL = chờ nhận. Chỉ `receiveIncome()` cộng lương và mở kỳ mới; không có nút "bắt đầu tháng" riêng.
- Số liệu do code tính; AI (Gemini → Workers AI) chỉ đọc tin nhắn / nhận xét trên số đã tính sẵn.

## Điểm dễ sai

- Regex tiếng Việt: `\b` của JS không coi chữ có dấu là chữ ("thẻ", "nợ"); dùng `(?=\s|$)`.
- Tin Telegram dùng `parse_mode: HTML`: chữ của người dùng / AI phải qua `esc()`.
- Thêm lệnh bot thì sửa 3 chỗ: `HELP` (src/index.ts), `scripts/bot-commands.json` (menu "/"), bảng hướng dẫn trong
  `admin/src/pages/AccountSettings.tsx`.
- `wrangler.toml` là file riêng của mỗi bản cài (bị ignore); đổi cấu hình chung thì sửa cả `wrangler.example.toml`.
- Đổi giờ cron thì sửa cả `CRON_DAILY` / `CRON_REMIND` trong `src/index.ts`.
- Trang quản lý: màu / font trong `admin/src/index.css` (`@theme`), icon lucide (không emoji), kiểm tra cả màn 390px.

## Test trên máy trước khi deploy

`wrangler.local-test.toml` = `wrangler.toml` bỏ `[ai]`; `.dev.vars` có `TELEGRAM_API=http://localhost:8799`.

```bash
npx wrangler d1 execute DB --local -c wrangler.local-test.toml --file=schema.sql
node scripts/migrate.mjs --local -c wrangler.local-test.toml
node scripts/mock-telegram.mjs /tmp/tg.jsonl ./anh-test &      # Telegram giả, ghi tin bot gửi vào /tmp/tg.jsonl
npx wrangler dev -c wrangler.local-test.toml --port 8787 &
./scripts/send.sh "phở 45k"                                    # CHAT=222 ./scripts/send.sh … để đổi người gửi
# Bấm nút inline: POST /webhook với {"callback_query":{"id":"x","data":"inc:3","message":{"message_id":1,"chat":{"id":111,"type":"private"}}}}
# Chạy cron: POST localhost:8787/cdn-cgi/local/explorer/api/local/scheduled?worker=<tên> -d '{"cron":"5 17 * * *"}'
```

Trang quản lý: `cd admin && npx vite --port 5199` (proxy `/admin/api` sang 8787).

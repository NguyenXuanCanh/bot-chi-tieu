# Handover: Chi Tiêu Bot

Tài liệu bàn giao cho người tiếp nhận: hệ thống là gì, cấu hình thế nào, deploy và vận hành ra sao, còn gì dở dang.
Mỗi người nhận repo tự dựng một bản riêng trên tài khoản Cloudflare của mình bằng `npm run setup`
(xem [README.md](README.md)); repo không chứa địa chỉ, khóa hay database của bản nào cả.

## 1. Tổng quan

Bot Telegram ghi chi tiêu bằng tin nhắn thường ("phở 45k, grab 60k") hoặc ảnh hóa đơn, kèm trang quản lý web.

| | |
|---|---|
| Trang quản lý | `https://<tên-worker>.<subdomain>.workers.dev` (mỗi bản cài một địa chỉ) |
| Bot Telegram | Bot riêng của mỗi bản cài, tạo bằng @BotFather |
| Hạ tầng | Cloudflare Workers + D1 (SQLite) + Workers AI, gói Free |
| AI | Gemini (`gemini-3.5-flash-lite`, gói miễn phí) → dự phòng Workers AI (`@cf/openai/gpt-oss-20b`) → bộ đọc đơn giản bằng regex |

Tính năng chính:

- **Ghi chi tiêu**: tin nhắn, ảnh hóa đơn/chuyển khoản (Gemini đọc ảnh), "hôm qua …", nhiều khoản một tin.
  Reply vào tin bot để sửa (`60k`, `ăn uống`, `hôm qua`, `xóa`).
- **Du lịch**: chi ở thành phố khác thành phố nhà thì tự gom thành chuyến; `/dulich`, `/venha`.
- **Lương & hũ**: lương theo tháng (về ngày 27, đổi được), 4 hũ (bắt buộc, tiêu xài, nạp game, tiết kiệm).
  AI nhắc khi hũ chạm 80% hoặc vượt mức.
- **Chi cố định hằng tháng**: cron tự ghi vào đúng ngày.
- **Dư nợ trả sau** (thẻ tín dụng, MoMo / ZaloPay / SPayLater trả sau): không tính vào tháng mua; ngày 1 tháng sau tự
  thành chi tiêu. Thanh toán sớm được (hết, một nguồn, hoặc một phần).
- **Số dư & dự báo**: tiền đang có, dự báo cuối tháng này và cuối tháng sau.
- **Mục tiêu tiết kiệm**: AI lập kế hoạch giữ/giảm/cắt theo danh mục.
- **Báo cáo**: tổng kết tháng (ngày 1), nhắc 21h nếu chưa ghi gì, `/hoi` và ô hỏi đáp trên web.
- **Tài khoản**: nhiều người dùng, dữ liệu tách theo tài khoản, liên kết Telegram bằng mã xác minh.

## 2. Kiến trúc

Một Worker duy nhất phục vụ cả bot, API và trang web tĩnh (cùng domain nên không cần CORS):

```
Telegram ──POST /webhook──┐
Trình duyệt ──/admin/api/*─┼──► Worker (src/index.ts) ──► D1 "chi-tieu"
Trình duyệt ──/ , /budget…─┘        │                    └► Gemini / Workers AI
                                    └── cron 00:05 & 21:00 giờ VN
Đường dẫn khác → file tĩnh admin/dist (SPA, not_found → index.html)
```

`wrangler.toml` → `[assets] run_worker_first = ["/webhook", "/admin/api/*", "/health"]`: chỉ 3 đường này chạy code,
còn lại Cloudflare trả file tĩnh (miễn phí, không tính request).

### Cấu trúc thư mục

```
src/                 Backend (Worker, TypeScript)
  index.ts           Webhook Telegram: lệnh bot, ghi chi tiêu, ảnh, reply-sửa, cron (scheduled)
  admin.ts           API trang quản lý /admin/api/* (đăng nhập, chi tiêu, chuyến, hũ, mục tiêu…)
  accounts.ts        Tài khoản: băm mật khẩu PBKDF2, token HMAC, liên kết Telegram, chuyển dữ liệu
  ai.ts              Gọi Gemini / Workers AI, đọc tin nhắn, đọc ảnh, trả lời câu hỏi; kiểu Env
  core.ts            Hàm thuần có test: đọc số tiền, ngày, thành phố, mục tiêu, danh mục, hũ
  budget.ts          Hũ, tình hình tháng, nhận xét AI, mục tiêu tiết kiệm + kế hoạch AI
  balance.ts         Số dư hiện tại + dự báo (tính cả ngày lương, nợ thẻ, khoản cố định)
  recurring.ts       Chi cố định hằng tháng (cron tự trừ)
  credit.ts          Dư nợ trả sau: ngày 1 tháng sau thành chi tiêu, thanh toán sớm
  reports.ts         Tổng kết tháng, nhắc 21h, nhắc ngày lương
  ask.ts             Hỏi đáp chi tiêu (dùng chung cho /hoi và web)
  prefs.ts           Tùy chọn theo chat (ngày lương, tắt nhắc)
  telegram.ts        Gửi tin, tải ảnh từ Telegram
admin/               Frontend: React 19 + Vite + Tailwind v4 + recharts (package.json riêng)
  src/pages/         Tổng quan, Chi tiêu, Ngân sách, Mục tiêu, Chuyến đi, Cài đặt
  design-system/     Bộ màu/kiểu chữ (sinh bằng skill UI UX Pro Max, kiểu "Data-Dense Dashboard")
schema.sql           Toàn bộ bảng D1 (CREATE … IF NOT EXISTS, chạy lại an toàn)
test/core.test.ts    Test các hàm trong core.ts (node:test)
scripts/             Telegram giả + script giả lập tin nhắn để test trên máy
```

## 3. Dữ liệu

**Khóa dữ liệu là `chat_id`.** Mọi bảng nghiệp vụ đều có cột `chat_id`:

- Tài khoản đã liên kết Telegram → `chat_id` = ID Telegram.
- Tài khoản chỉ dùng web → `chat_id` = `-users.id` (số âm). Bot chỉ nhận chat riêng (ID dương) nên không trùng.
- Liên kết / hủy liên kết sẽ chuyển dữ liệu giữa hai khóa: `moveData()` trong `src/accounts.ts`.
  **Thêm bảng mới có `chat_id` thì phải thêm vào `DATA_TABLES` hoặc `KEYED_TABLES` ở đó.**

| Bảng | Nội dung |
|---|---|
| `expenses` | Khoản chi (`spent_on` theo giờ VN, `message_id` để /xoa và reply-sửa; NULL nếu do cron/admin tạo) |
| `trips` | Chuyến đi (`manual` = 1 nếu bật bằng /dulich) |
| `settings` | Thành phố nhà, chuyến đang bật |
| `incomes` | Thu nhập theo tháng (`month` = YYYY-MM) |
| `jars`, `category_jars` | Số tiền mỗi hũ; danh mục → hũ (không có dòng = mặc định trong `core.ts`) |
| `goals` | Mục tiêu tiết kiệm (một mục tiêu `active` mỗi lúc), `plan` = JSON kế hoạch AI |
| `recurring` | Chi cố định (`start_month`, `last_month` để không trừ trùng) |
| `credit_charges` | Dư nợ trả sau (`provider`: card/momo/zalopay/spaylater/other; `settled` = 1 khi đã thành chi tiêu) |
| `balances` | Các lần nhập số dư (lấy lần mới nhất) |
| `bot_messages` | Tin bot đã gửi ↔ khoản chi, để reply-sửa |
| `prefs` | `payday`, `remind` theo chat |
| `users`, `link_codes` | Tài khoản web; mã xác minh liên kết Telegram |

Ngày giờ: mọi ngày lưu dạng `YYYY-MM-DD` theo **giờ Việt Nam (UTC+7)**: `vnDate()` trong `core.ts`.
Tiền: số nguyên VND.

## 4. Cấu hình

**`wrangler.toml` là file riêng của mỗi bản cài** (bị ignore): `npm run setup` tạo từ `wrangler.example.toml`
và điền tên Worker + `database_id`. Sửa cấu hình chung (cron, biến) thì sửa **cả hai** file.

**Biến thường** (`[vars]`): `GEMINI_MODEL`, `DEFAULT_HOME_CITY`. Tùy chọn: `APP_URL` (mặc định lấy domain đang chạy),
`BOT_USERNAME` (mặc định hỏi Telegram qua `getMe`).

**Secret** (`npx wrangler secret put <TÊN>`, không bao giờ commit):

| Secret | Bắt buộc | Ý nghĩa |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | có | Token từ @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | có | Telegram gửi kèm header, sai thì 403. `setup` sinh mới mỗi lần chạy và gắn lại webhook |
| `GEMINI_API_KEY` | nên có | Không có thì dùng Workers AI |
| `AUTH_SECRET` | có | Khóa ký token đăng nhập. Đổi khóa = mọi người phải đăng nhập lại |
| `ALLOWED_CHAT_IDS` | không | Chat luôn được dùng bot dù chưa liên kết tài khoản, cách nhau dấu phẩy |
| `SIGNUP_CODE` | không | Có giá trị thì tạo tài khoản phải nhập mã mời này; không đặt thì ai có link cũng đăng ký được |
| `ADMIN_PASSWORD` | không | Di sản bản đầu, chỉ dùng làm khóa dự phòng nếu thiếu `AUTH_SECRET` |

Xem danh sách đang có: `npx wrangler secret list`.

**Chạy trên máy**: xem mục 5. **Không** đưa `TELEGRAM_API` lên server.

D1: binding `DB`, tên mặc định `chi-tieu`; các lệnh `npm run db:*` gọi theo binding nên không phụ thuộc tên.

## 5. Chạy trên máy

Cần Node 22 (`nvm use 22`).

```bash
npm install && npm --prefix admin install
npm test                         # test core.ts
npm run typecheck                # backend; frontend: cd admin && npx tsc -b

# Worker + D1 local. wrangler.local-test.toml = wrangler.toml bỏ [ai] (setup tạo sẵn; binding AI cần đăng nhập remote).
npx wrangler d1 execute DB --local -c wrangler.local-test.toml --file=schema.sql
node scripts/mock-telegram.mjs /tmp/tg.jsonl ./anh-test &   # Telegram giả; thư mục ảnh để test gửi ảnh
npx wrangler dev -c wrangler.local-test.toml --port 8787
./scripts/send.sh "phở 45k"                   # giả lập tin nhắn (CHAT=222 ./scripts/send.sh … để đổi người gửi)

# Gọi cron bằng tay (đường /__scheduled bị static assets chặn):
curl -X POST "localhost:8787/cdn-cgi/local/explorer/api/local/scheduled?worker=chi-tieu-bot" \
  -H 'Content-Type: application/json' -d '{"cron":"5 17 * * *"}'

# Trang quản lý (proxy /admin/api sang 8787):
cd admin && npx vite --port 5199
```

`wrangler.local-test.toml` bị ignore; `npm run setup` tạo sẵn, hoặc chép `wrangler.toml` rồi xóa khối `[ai]`.
`.dev.vars` (bị ignore) chứa secret cho bản local, tối thiểu: `TELEGRAM_BOT_TOKEN=x`, `TELEGRAM_WEBHOOK_SECRET=local-secret`,
`AUTH_SECRET=<chuỗi bất kỳ>`, `TELEGRAM_API=http://localhost:8799`, (tùy chọn) `GEMINI_API_KEY`, `ALLOWED_CHAT_IDS=111`.
Trên máy không có Workers AI, nên khi Gemini lỗi thì phần dự phòng sẽ lỗi theo (trên server thì có).

## 6. Deploy

Lần đầu: `npm run setup` (mục README). Các lần sau:

```bash
npm run db:remote     # chỉ khi schema.sql có bảng/chỉ mục mới (IF NOT EXISTS nên chạy lại an toàn)
npm run deploy        # build admin rồi wrangler deploy (đăng ký luôn 2 cron)
```

- **Đổi cấu trúc bảng đã có** (thêm cột…): thêm câu `ALTER TABLE` vào mảng `MIGRATIONS` trong `scripts/migrate.mjs`
  **và** sửa `CREATE TABLE` tương ứng trong `schema.sql` (cho bản cài mới), rồi chạy `npm run db:migrate` **trước**
  `npm run deploy`. Script chạy lại an toàn (cột đã có thì bỏ qua); `npm run setup` cũng tự chạy nó.
- Webhook và menu lệnh do `setup` đặt. Đổi domain hoặc bot thì chạy lại `npm run setup`.
- Thêm lệnh bot mới thì cập nhật cả 3 chỗ: `scripts/bot-commands.json` (menu "/", áp dụng khi chạy setup),
  `HELP` trong `src/index.ts`, và bảng hướng dẫn trong `admin/src/pages/AccountSettings.tsx`.

## 7. Vận hành

- **Cron** (`wrangler.toml` `[triggers]`, giờ UTC):
  - `5 17 * * *` (00:05 VN): chuyển nợ thẻ → trừ khoản cố định → ngày 1 gửi tổng kết tháng → ngày lương nhắc nhập lương.
  - `0 14 * * *` (21:00 VN): nhắc nếu hôm đó chưa ghi gì.
  - Đổi giờ thì sửa cả `CRON_DAILY` / `CRON_REMIND` trong `src/index.ts`.
- **Xem log trực tiếp**: `npx wrangler tail`. Lỗi được ghi với tiền tố `[bot]`, `[cron]`, `[admin]`, `[parse]`, `[ask]`.
- **Kiểm tra sống**: `GET /health` → `chi-tieu-bot ok`. Webhook: `getWebhookInfo` (xem `last_error_message`).
- **Sao lưu**: `npx wrangler d1 export chi-tieu --remote --output backup.sql`. D1 cũng có Time Travel 30 ngày.
- **Chi phí**: gói Free không tự trừ tiền; vượt hạn mức thì request lỗi tới hết ngày (UTC). Hạn mức chính:
  100k request/ngày, 10ms CPU/request, D1 5 triệu dòng đọc/ngày. Gemini gói miễn phí có giới hạn lượt/phút.

## 8. Bảo mật

- Webhook kiểm tra `X-Telegram-Bot-Api-Secret-Token`. Bot chỉ nhận chat riêng, và chỉ từ chat đã liên kết tài khoản
  (hoặc nằm trong `ALLOWED_CHAT_IDS`). Người lạ chỉ nhận hướng dẫn tạo tài khoản.
- Mật khẩu: PBKDF2-SHA256, 10.000 vòng (vì giới hạn CPU gói Free), salt riêng; số vòng lưu trong hash để tăng sau.
  Đăng nhập sai bị làm chậm 800ms. Token 7 ngày, ký HMAC; đổi mật khẩu thì token cũ mất hiệu lực (`token_version`).
- Liên kết Telegram cần mã 6 số bot gửi vào chính chat đó (hết hạn 10 phút, sai 5 lần thì phải gửi lại).
- Mọi truy vấn API đều lọc theo `chat_id` của người đăng nhập. Sửa/xóa theo id luôn kèm `AND chat_id = ?`.
  **Giữ nguyên quy tắc này khi thêm API mới.**
- Xuất CSV chặn công thức Excel (CSV injection).
- Quyền riêng tư: nội dung tin nhắn, ảnh và câu hỏi được gửi cho Gemini. Gói miễn phí của Google có thể dùng dữ liệu
  này để cải thiện sản phẩm. Chủ tài khoản Cloudflare đọc được toàn bộ database.

## 9. Việc còn dở / đã biết

Lỗi nhỏ:

- Reply đổi ngày một khoản thuộc chuyến du lịch không nới ngày đi/về của chuyến.
- Xóa khoản cố định vừa tự trừ thì tháng đó không trừ lại được (vì `last_month` đã đặt).
- Thưởng nhập trước ngày lương cũng chỉ cộng vào số dư ở ngày lương; lương trung bình tính cả thưởng.
- Nhắc 21h không tính khoản thêm trên web là "đã ghi".
- Mọi nguồn trả sau đều trừ ngày 1 tháng sau; chưa hỗ trợ ngày đến hạn riêng theo từng ví / thẻ.
- Ảnh hóa đơn chưa có dự phòng khi Gemini lỗi (Workers AI có model đọc ảnh, chưa nối).
- `bot_messages` chưa có dọn dẹp định kỳ.

Nên làm:

- Script test tự động toàn luồng bot (hiện chỉ có test cho `core.ts`; các luồng khác đã test tay theo mục 5).
- Migration hiện chỉ hỗ trợ thêm cột (bỏ qua lỗi "duplicate column"); đổi/xóa cột thì cần cách khác.
- Quyết định có bật `SIGNUP_CODE` không (đăng ký đang mở cho mọi người, dùng chung hạn mức AI miễn phí).
- Cập nhật README cho đủ các tính năng mới (hiện README chỉ có phần cơ bản).

## 10. Checklist trước khi push

- [x] `.gitignore` chặn: `node_modules/`, `.wrangler/`, `.dev.vars`, `.webhook-secret`, `wrangler.toml`,
      `wrangler.local-test.toml`, `admin/dist/`, `admin/.claude/` (skill bên thứ ba ~4.5MB).
- [x] Repo không chứa địa chỉ, account id, database id, token hay khóa của bản cài nào.
- [ ] `git add -A && git status`: kiểm tra lại danh sách, rồi commit đầu tiên.
- [ ] `git remote add origin <url> && git push -u origin main`.
- [ ] Người tiếp nhận: clone, `npm run setup` trên tài khoản Cloudflare và bot Telegram của họ. Không cần secret của bản khác.

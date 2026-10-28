# Chi Tiêu Bot 💸

Bot Telegram ghi chi tiêu bằng tin nhắn thường hoặc ảnh hóa đơn, kèm trang quản lý web: hũ chi tiêu, lương, số dư,
mục tiêu tiết kiệm, chi cố định, thẻ tín dụng, chuyến du lịch, báo cáo và hỏi đáp bằng AI. Nhiều người dùng, mỗi tài
khoản một vùng dữ liệu riêng.

Chạy trên **Cloudflare Workers + D1** (gói Free, không cần thẻ thanh toán). AI đọc tin nhắn bằng Gemini (gói miễn phí),
dự phòng Workers AI.

> Kiến trúc, dữ liệu, vận hành, việc còn dở: [HANDOVER.md](HANDOVER.md)

## Tự dựng bản riêng (khoảng 10 phút)

Cần chuẩn bị:

- Node 20 trở lên.
- Tài khoản Cloudflare (miễn phí).
- Một bot Telegram: nhắn [@BotFather](https://t.me/BotFather) → `/newbot` → lấy token.
- (Nên có) Gemini API key miễn phí: https://aistudio.google.com/apikey. Không có thì dùng Workers AI, đọc tin nhắn kém hơn.

```bash
git clone <repo> chi-tieu-bot && cd chi-tieu-bot
npm run setup
```

Script `setup` làm lần lượt:

1. Cài thư viện, mở trình duyệt để đăng nhập Cloudflare (nếu chưa đăng nhập).
2. Tạo `wrangler.toml` từ `wrangler.example.toml` (hỏi tên Worker) và tạo database D1, tạo bảng.
3. Hỏi token bot và Gemini key (không hiện khi gõ), tự sinh khóa webhook và khóa đăng nhập, đặt thành secret.
4. Deploy. Nếu tài khoản chưa có subdomain `workers.dev`, script đưa link để bạn chọn tên rồi chạy tiếp.
5. Gắn webhook Telegram và menu lệnh, in ra địa chỉ trang.

Sau đó mở trang → **Tạo tài khoản** → **Cài đặt → Liên kết Telegram** (nhập ID bot gửi khi bấm Start, rồi nhập mã
6 số bot gửi). Trong Cài đặt có bảng hướng dẫn đầy đủ các lệnh của bot.

Chạy lại `npm run setup` bất cứ lúc nào (VD đổi bot, đổi key): bước nào xong rồi sẽ được dùng lại.
`wrangler.toml` là file riêng của mỗi bản cài, không commit.

## Dùng bot

- `phở 45k, grab 60k` · `hôm qua cafe 35k` · gửi ảnh hóa đơn / ảnh chuyển khoản
- Du lịch: `lẩu 300k ở Đà Lạt` tự gom thành chuyến · `/dulich Đà Lạt` … `/venha`
- Lương & hũ: `/luong 25tr` · `/chiahu 10tr 6tr 1tr 8tr` · `/hu` · `/danhgia`
- `/sodu 15tr` · `/codinh tiền nhà 5tr ngày 5` · `/muctieu 50tr tới tháng 2 năm sau`
- Trả sau: `td phở 45k` (thẻ tín dụng) · `ts momo grab 60k` · `ts zalopay …` · `ts spay …` · trả sớm `/the tra`
- Báo cáo: `/homnay` `/tuan` `/thang` `/tongket` · `/hoi tháng này cà phê hết bao nhiêu?`
- Sửa nhanh: reply tin bot với `60k`, `ăn uống`, `hôm qua` hoặc `xóa`

Gõ `/help` trên bot để xem đủ.

## Phát triển

```bash
npm test && npm run typecheck        # test hàm thuần + kiểm tra kiểu backend
npm run deploy                       # build trang quản lý rồi deploy
npm run db:remote                    # khi schema.sql có bảng mới
npm run db:migrate                   # khi scripts/migrate.mjs có thay đổi cột (chạy trước deploy)
npx wrangler tail                    # xem log trực tiếp
```

Chạy thử trên máy (Telegram giả, D1 local): xem [HANDOVER.md](HANDOVER.md#5-chạy-trên-máy).

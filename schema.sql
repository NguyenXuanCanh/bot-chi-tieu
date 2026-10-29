-- Chi tiêu và chuyến đi. Ngày lưu theo giờ Việt Nam (YYYY-MM-DD).
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,          -- VND
  item TEXT NOT NULL,
  category TEXT NOT NULL,
  place TEXT,                       -- địa điểm cụ thể nếu có (VD "chợ Đà Lạt")
  city TEXT,                        -- thành phố / tỉnh (VD "Đà Lạt")
  trip_id INTEGER,
  spent_on TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  message_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_expenses_chat_day ON expenses (chat_id, spent_on);
CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses (trip_id);

CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  city TEXT NOT NULL,
  started_on TEXT NOT NULL,
  ended_on TEXT NOT NULL,
  manual INTEGER NOT NULL DEFAULT 0   -- 1 = bắt đầu bằng /dulich
);
CREATE INDEX IF NOT EXISTS idx_trips_chat ON trips (chat_id, ended_on);

CREATE TABLE IF NOT EXISTS settings (
  chat_id INTEGER PRIMARY KEY,
  home_city TEXT,
  active_trip_id INTEGER            -- chuyến đang bật bằng /dulich
);

-- Thu nhập theo tháng (lương, thưởng...). month = "YYYY-MM".
CREATE TABLE IF NOT EXISTS incomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  month TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  received_at INTEGER               -- NULL = lương chờ nhận (bấm "+lương" mới cộng vào số dư)
);
CREATE INDEX IF NOT EXISTS idx_incomes_chat_month ON incomes (chat_id, month);

-- Số tiền mỗi tháng cho từng hũ (bat_buoc, tieu_xai, game, tiet_kiem).
CREATE TABLE IF NOT EXISTS jars (
  chat_id INTEGER NOT NULL,
  jar TEXT NOT NULL,
  amount INTEGER NOT NULL,
  PRIMARY KEY (chat_id, jar)
);

-- Danh mục chi tiêu thuộc hũ nào (không có dòng = dùng mặc định trong src/core.ts).
CREATE TABLE IF NOT EXISTS category_jars (
  chat_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  jar TEXT NOT NULL,
  PRIMARY KEY (chat_id, category)
);

-- Mục tiêu tiết kiệm (mỗi lúc một mục tiêu đang chạy). plan = JSON kế hoạch do AI lập.
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  target INTEGER NOT NULL,
  saved_before INTEGER NOT NULL DEFAULT 0,  -- tiền đã có sẵn lúc đặt mục tiêu
  start_month TEXT NOT NULL,
  deadline TEXT NOT NULL,                   -- tháng cuối cùng, tính cả tháng đó
  plan TEXT,
  plan_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_chat ON goals (chat_id, active);

-- Khoản chi cố định hàng tháng, cron tự ghi thành chi tiêu vào ngày `day` (tháng ngắn thì ngày cuối tháng).
CREATE TABLE IF NOT EXISTS recurring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  item TEXT NOT NULL,
  amount INTEGER NOT NULL,
  category TEXT NOT NULL,
  day INTEGER NOT NULL,              -- 1..31
  active INTEGER NOT NULL DEFAULT 1,
  start_month TEXT NOT NULL,         -- tự trừ từ tháng này ("YYYY-MM")
  last_month TEXT,                   -- tháng gần nhất đã trừ
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recurring_chat ON recurring (chat_id, active);

-- Dư nợ trả sau (thẻ tín dụng, MoMo/ZaloPay/SPayLater trả sau): chưa tính là chi tiêu tháng mua; ngày 1 tháng sau cron chuyển thành chi tiêu của tháng sau.
CREATE TABLE IF NOT EXISTS credit_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  item TEXT NOT NULL,
  category TEXT NOT NULL,
  spent_on TEXT NOT NULL,            -- ngày quẹt thẻ / mua trả sau
  settled INTEGER NOT NULL DEFAULT 0, -- 1 = đã chuyển thành chi tiêu
  provider TEXT NOT NULL DEFAULT 'card', -- card | momo | zalopay | spaylater | other (src/core.ts PAYLATER)
  message_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_chat ON credit_charges (chat_id, settled);

-- Số dư tiền đang có do người dùng nhập. Số dư hiện tại = lần nhập gần nhất + thu nhập ghi sau đó − chi tiêu sau đó.
CREATE TABLE IF NOT EXISTS balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  day TEXT NOT NULL,                 -- ngày nhập (giờ VN)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_balances_chat ON balances (chat_id, id);

-- Tin nhắn bot đã gửi khi ghi khoản chi / quẹt thẻ: reply vào đó để sửa nhanh. ref = message_id tin nhắn gốc của người dùng.
CREATE TABLE IF NOT EXISTS bot_messages (
  chat_id INTEGER NOT NULL,
  bot_message_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                -- 'expense' | 'credit'
  ref INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, bot_message_id)
);

-- Tùy chọn nhỏ theo chat (VD remind = '0' để tắt nhắc 21h).
CREATE TABLE IF NOT EXISTS prefs (
  chat_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (chat_id, key)
);

-- Tài khoản trang quản lý. Dữ liệu của tài khoản nằm dưới chat_id Telegram đã liên kết; chưa liên kết thì dưới -id (số âm, không trùng chat Telegram riêng).
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,       -- pbkdf2$<vòng lặp>$<salt>$<hash>
  chat_id INTEGER UNIQUE,            -- Telegram đã xác minh
  token_version INTEGER NOT NULL DEFAULT 0, -- tăng khi đổi mật khẩu để đăng xuất mọi nơi
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

-- Mã xác minh khi liên kết Telegram (bot gửi mã vào chat đó, người dùng nhập lại trên web).
CREATE TABLE IF NOT EXISTS link_codes (
  user_id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL
);

-- Ngày bắt đầu các kỳ chi tiêu: tự thêm khi bấm nhận lương. Kỳ chạy tới hết ngày trước kỳ sau (src/core.ts cyclePeriods).
CREATE TABLE IF NOT EXISTS cycles (
  chat_id INTEGER NOT NULL,
  start_on TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, start_on)
);

-- Sổ nợ. direction: lend = mình cho mượn (người khác nợ mình), borrow = mình đi vay.
-- Tiền cho mượn / trả nợ đi ra, vay / được trả đi vào số dư; không tính là chi tiêu hay thu nhập (không vào hũ).
CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  direction TEXT NOT NULL,
  person TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT,
  start_on TEXT NOT NULL,
  due_on TEXT,                          -- hẹn trả (NULL = không hẹn)
  counts_balance INTEGER NOT NULL DEFAULT 1, -- 0 = nợ cũ: tiền đã đi/về trước khi nhập số dư
  settled_at INTEGER,                   -- trả đủ lúc nào (NULL = còn nợ)
  message_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_debts_chat ON debts (chat_id, settled_at);

CREATE TABLE IF NOT EXISTS debt_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  paid_on TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_debt_payments_debt ON debt_payments (debt_id);

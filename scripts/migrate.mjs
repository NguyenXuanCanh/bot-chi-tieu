#!/usr/bin/env node
// Đổi cấu trúc bảng đã có (thêm cột…) cho database D1. Chạy lại an toàn: cột đã có thì bỏ qua.
// schema.sql chỉ tạo bảng mới (CREATE … IF NOT EXISTS) nên không thêm được cột vào bảng cũ; thay đổi kiểu đó ghi ở đây.
// Chạy: npm run db:migrate (remote)  ·  node scripts/migrate.mjs --local -c wrangler.local-test.toml
import { spawnSync } from 'node:child_process';

const MIGRATIONS = [
  // 2026-10: dư nợ trả sau có nhiều nguồn (thẻ, MoMo, ZaloPay, SPayLater).
  "ALTER TABLE credit_charges ADD COLUMN provider TEXT NOT NULL DEFAULT 'card'",
  // 2026-10: lương có trạng thái chờ nhận / đã nhận. Thu nhập các tháng trước và thưởng coi như đã nhận lúc ghi;
  // lương tháng hiện tại để chờ người dùng bấm "+lương".
  'ALTER TABLE incomes ADD COLUMN received_at INTEGER',
  "UPDATE incomes SET received_at = created_at WHERE received_at IS NULL AND (month < strftime('%Y-%m', 'now', '+7 hours') OR (note IS NOT NULL AND note NOT LIKE 'Lương%'))",
  // 2026-10: chuyển khoản chi sang trả sau mà vẫn giữ chuyến đi / nơi chốn.
  'ALTER TABLE credit_charges ADD COLUMN trip_id INTEGER',
  'ALTER TABLE credit_charges ADD COLUMN city TEXT',
  'ALTER TABLE credit_charges ADD COLUMN place TEXT',
];

const extra = process.argv.slice(2);
const target = extra.includes('--local') ? [] : ['--remote'];
let failed = false;
for (const sql of MIGRATIONS) {
  const r = spawnSync('npx', ['--yes', 'wrangler', 'd1', 'execute', 'DB', ...target, ...extra, '--command', sql], { encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  if (r.status === 0) console.log(`✓ ${sql}`);
  else if (/duplicate column name/i.test(out)) console.log(`· đã có: ${sql}`);
  else {
    failed = true;
    console.error(`✗ ${sql}\n${out.slice(-1500)}`);
  }
}
process.exit(failed ? 1 : 0);

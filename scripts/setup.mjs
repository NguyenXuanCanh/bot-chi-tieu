#!/usr/bin/env node
// Dựng một bản Chi Tiêu Bot riêng trên tài khoản Cloudflare của bạn: database, secret, deploy, webhook Telegram.
// Chạy: npm run setup   (chạy lại được nhiều lần, bước nào xong rồi sẽ bỏ qua hoặc hỏi lại)
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const CONFIG = 'wrangler.toml';
const TEMPLATE = 'wrangler.example.toml';

const step = (n, text) => console.log(`\n\x1b[1m[${n}] ${text}\x1b[0m`);
const ok = (text) => console.log(`  \x1b[32m✓\x1b[0m ${text}`);
const warn = (text) => console.log(`  \x1b[33m!\x1b[0m ${text}`);
const fail = (text) => {
  console.error(`\n\x1b[31m✗ ${text}\x1b[0m`);
  process.exit(1);
};

function ask(question, fallback = '') {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${question}${fallback ? ` [${fallback}]` : ''}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || fallback);
    });
  });
}

/** Hỏi mà không hiện chữ đang gõ (token, key). */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const prompt = `  ${question}: `;
    rl._writeToOutput = (s) => {
      if (s.includes(prompt)) process.stdout.write(prompt);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

/** Chạy wrangler; inherit = hiện thẳng ra màn hình (để người dùng tương tác, VD đăng nhập). */
function wrangler(args, { input, inherit } = {}) {
  const result = spawnSync('npx', ['--yes', 'wrangler', ...args], {
    input,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
  });
  return { code: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const tomlValue = (text, key) => text.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1];

async function telegram(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return response.json();
}

// ---------------------------------------------------------------------------

console.log('\x1b[1mChi Tiêu Bot — cài đặt bản riêng trên Cloudflare (gói Free)\x1b[0m');
console.log('Cần: tài khoản Cloudflare, một bot Telegram tạo bằng @BotFather, (nên có) Gemini API key từ https://aistudio.google.com');

if (Number(process.versions.node.split('.')[0]) < 20) fail(`Cần Node 20 trở lên (đang dùng ${process.version}).`);

step(1, 'Cài thư viện');
if (!fs.existsSync('node_modules')) spawnSync('npm', ['install'], { stdio: 'inherit' });
if (!fs.existsSync('admin/node_modules')) spawnSync('npm', ['--prefix', 'admin', 'install'], { stdio: 'inherit' });
ok('Đã có thư viện cho Worker và trang quản lý');

step(2, 'Đăng nhập Cloudflare');
let who = wrangler(['whoami']);
if (/not authenticated|You are not logged in/i.test(who.out)) {
  console.log('  Trình duyệt sẽ mở để bạn đăng nhập Cloudflare…');
  wrangler(['login'], { inherit: true });
  who = wrangler(['whoami']);
}
if (/not authenticated|You are not logged in/i.test(who.out)) fail('Chưa đăng nhập được Cloudflare. Chạy `npx wrangler login` rồi chạy lại setup.');
const email = who.out.match(/email ([^\s]+?)\.?(\s|$)/)?.[1];
ok(`Đã đăng nhập${email ? `: ${email}` : ''}`);

step(3, 'File cấu hình wrangler.toml');
let config;
if (fs.existsSync(CONFIG)) {
  config = fs.readFileSync(CONFIG, 'utf8');
  ok(`Dùng ${CONFIG} có sẵn (Worker "${tomlValue(config, 'name')}")`);
} else {
  const name = await ask('Tên Worker (thành địa chỉ <tên>.<subdomain>.workers.dev)', 'chi-tieu-bot');
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) fail('Tên chỉ gồm chữ thường, số và dấu gạch ngang.');
  config = fs.readFileSync(TEMPLATE, 'utf8').replace('__WORKER_NAME__', name);
  fs.writeFileSync(CONFIG, config);
  ok(`Đã tạo ${CONFIG} từ ${TEMPLATE}`);
}
const workerName = tomlValue(config, 'name');

step(4, 'Database D1');
const dbName = tomlValue(config, 'database_name') ?? 'chi-tieu';
if (tomlValue(config, 'database_id') === '__DATABASE_ID__') {
  let created = wrangler(['d1', 'create', dbName]);
  let id = created.out.match(/database_id\s*=\s*"?([0-9a-f-]{36})/)?.[1];
  if (!id && /already exists/i.test(created.out)) {
    const list = wrangler(['d1', 'list', '--json']);
    try {
      id = JSON.parse(list.out.slice(list.out.indexOf('['))).find((d) => d.name === dbName)?.uuid;
    } catch {
      /* xử lý bên dưới */
    }
    if (id) warn(`Database "${dbName}" đã có sẵn trong tài khoản, dùng lại nó.`);
  }
  if (!id) fail(`Không tạo được database:\n${created.out}`);
  config = config.replace('__DATABASE_ID__', id);
  fs.writeFileSync(CONFIG, config);
  ok(`Database "${dbName}" (${id})`);
} else {
  ok(`Dùng database có sẵn (${tomlValue(config, 'database_id')})`);
}
const schema = wrangler(['d1', 'execute', 'DB', '--remote', '--file=schema.sql']);
if (schema.code !== 0) fail(`Tạo bảng lỗi:\n${schema.out}`);
ok('Đã tạo/cập nhật các bảng (chạy lại an toàn)');
if (spawnSync('node', ['scripts/migrate.mjs'], { stdio: 'inherit' }).status !== 0) fail('Cập nhật cấu trúc bảng lỗi (xem trên).');

// Bản cấu hình để chạy thử trên máy: bỏ [ai] vì binding AI cần đăng nhập remote.
fs.writeFileSync('wrangler.local-test.toml', config.replace(/\[ai\]\nbinding = "AI"\n\n?/, ''));

step(5, 'Bot Telegram');
let token;
let bot;
for (;;) {
  token = await askHidden('Token bot (lấy từ @BotFather, dạng 123456:ABC…, không hiện khi gõ)');
  const me = await telegram(token, 'getMe').catch(() => null);
  if (me?.ok) {
    bot = me.result;
    break;
  }
  warn('Token không đúng, thử lại.');
}
ok(`Bot @${bot.username}`);

step(6, 'Secret');
const listed = wrangler(['secret', 'list']);
const has = (name) => listed.code === 0 && listed.out.includes(`"${name}"`);
const put = (name, value) => {
  const r = wrangler(['secret', 'put', name], { input: value });
  if (r.code !== 0) fail(`Đặt secret ${name} lỗi:\n${r.out}`);
  ok(`${name}`);
};
const webhookSecret = randomBytes(24).toString('hex');
put('TELEGRAM_BOT_TOKEN', token);
put('TELEGRAM_WEBHOOK_SECRET', webhookSecret);
if (has('AUTH_SECRET')) ok('AUTH_SECRET (giữ nguyên, đổi thì mọi người phải đăng nhập lại)');
else put('AUTH_SECRET', randomBytes(32).toString('hex'));
const gemini = await askHidden(`Gemini API key (Enter để ${has('GEMINI_API_KEY') ? 'giữ key cũ' : 'bỏ qua, dùng Workers AI'})`);
if (gemini) put('GEMINI_API_KEY', gemini);
if (!has('SIGNUP_CODE')) {
  const invite = await ask('Mã mời khi tạo tài khoản (Enter = ai có link cũng đăng ký được)');
  if (invite) put('SIGNUP_CODE', invite);
}

step(7, 'Deploy');
let url;
for (;;) {
  const deploy = spawnSync('npm', ['run', 'deploy'], { encoding: 'utf8' });
  const out = `${deploy.stdout}${deploy.stderr}`;
  url = out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0];
  if (url) break;
  const onboarding = out.match(/https:\/\/dash\.cloudflare\.com\/[^\s]+onboarding/)?.[0];
  if (onboarding) {
    warn('Tài khoản chưa có subdomain workers.dev. Mở link dưới, chọn một tên subdomain, rồi quay lại nhấn Enter:');
    console.log(`    ${onboarding}`);
    await ask('Nhấn Enter khi xong');
    continue;
  }
  fail(`Deploy lỗi:\n${out.slice(-3000)}`);
}
ok(`Đã deploy: ${url}`);

console.log('  Đợi địa chỉ mới hoạt động (subdomain mới có thể mất 1–3 phút)…');
for (let i = 0; i < 40; i++) {
  const alive = await fetch(`${url}/health`).then((r) => r.ok).catch(() => false);
  if (alive) break;
  await new Promise((r) => setTimeout(r, 5000));
}

step(8, 'Kết nối Telegram');
const hook = await telegram(token, 'setWebhook', { url: `${url}/webhook`, secret_token: webhookSecret, drop_pending_updates: true });
if (!hook.ok) fail(`Đặt webhook lỗi: ${hook.description}`);
ok('Webhook');
const commands = JSON.parse(fs.readFileSync('scripts/bot-commands.json', 'utf8'));
const menu = await telegram(token, 'setMyCommands', { commands });
menu.ok ? ok('Menu lệnh "/"') : warn(`Không đặt được menu lệnh: ${menu.description}`);

console.log(`
\x1b[1;32mXong! Bản của bạn: ${url}\x1b[0m
  1. Mở trang, tạo tài khoản.
  2. Mở https://t.me/${bot.username}, bấm Start: bot trả về ID Telegram của bạn.
  3. Trên trang: Cài đặt → Liên kết Telegram → nhập ID → nhập mã 6 số bot gửi.
Deploy lại sau khi sửa code: npm run deploy  ·  Xem log: npx wrangler tail ${workerName}
`);

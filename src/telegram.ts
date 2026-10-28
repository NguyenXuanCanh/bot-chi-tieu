import type { Env } from './ai';

/** Gọi Telegram Bot API (đổi địa chỉ bằng TELEGRAM_API khi test trên máy). */

const base = (env: Env) => env.TELEGRAM_API || 'https://api.telegram.org';

export const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Gửi tin nhắn HTML; trả về message_id của tin bot vừa gửi (null nếu lỗi). */
export async function send(env: Env, chatId: number, text: string): Promise<number | null> {
  // Khóa âm = tài khoản chỉ dùng web, không có chat Telegram để gửi.
  if (chatId <= 0) return null;
  const response = await fetch(`${base(env)}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!response.ok) {
    console.error('[telegram] gửi lỗi:', response.status, await response.text());
    return null;
  }
  const data = (await response.json().catch(() => ({}))) as { result?: { message_id?: number } };
  return data.result?.message_id ?? null;
}

/** Username của bot (BOT_USERNAME nếu có, không thì hỏi Telegram một lần rồi nhớ trong lúc Worker còn chạy). */
let cachedUsername: string | null = null;
export async function botUsername(env: Env): Promise<string | null> {
  if (env.BOT_USERNAME) return env.BOT_USERNAME;
  if (cachedUsername) return cachedUsername;
  try {
    const data = (await (await fetch(`${base(env)}/bot${env.TELEGRAM_BOT_TOKEN}/getMe`)).json()) as { result?: { username?: string } };
    cachedUsername = data.result?.username ?? null;
  } catch (error) {
    console.error('[telegram] getMe lỗi:', error);
  }
  return cachedUsername;
}

/** Hiện "đang gõ…" trong lúc AI đọc ảnh. */
export async function typing(env: Env, chatId: number) {
  await fetch(`${base(env)}/bot${env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  }).catch(() => undefined);
}

/** Tải file người dùng gửi (ảnh) về dạng base64. */
export async function downloadFile(env: Env, fileId: string): Promise<{ data: string; size: number }> {
  const info = (await (await fetch(`${base(env)}/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`)).json()) as {
    ok: boolean;
    result?: { file_path?: string };
  };
  if (!info.ok || !info.result?.file_path) throw new Error('Không lấy được file từ Telegram');
  const response = await fetch(`${base(env)}/file/bot${env.TELEGRAM_BOT_TOKEN}/${info.result.file_path}`);
  if (!response.ok) throw new Error(`Tải file lỗi ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: btoa(binary), size: bytes.length };
}

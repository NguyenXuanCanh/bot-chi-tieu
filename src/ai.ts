import { CATEGORY_NAMES, daysBetween, fallbackParse, toCategory, type Parsed } from './core';

export type Env = {
  DB: D1Database;
  AI: Ai;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  /** Danh sách chat id được dùng bot, cách nhau bởi dấu phẩy. */
  ALLOWED_CHAT_IDS: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL: string;
  DEFAULT_HOME_CITY: string;
  /** Mật khẩu admin cũ (chỉ còn dùng làm khóa ký token nếu chưa có AUTH_SECRET). */
  ADMIN_PASSWORD?: string;
  /** Khóa ký token đăng nhập. */
  AUTH_SECRET?: string;
  /** Có giá trị thì tạo tài khoản phải nhập đúng mã mời này. */
  SIGNUP_CODE?: string;
  /** Tùy chọn: ghi đè địa chỉ trang (mặc định lấy domain đang chạy) và username bot (mặc định hỏi Telegram). */
  APP_URL?: string;
  BOT_USERNAME?: string;
  /** Địa chỉ Telegram Bot API (đổi khi test trên máy). */
  TELEGRAM_API?: string;
};

const FALLBACK_MODEL = '@cf/openai/gpt-oss-20b';

const PARSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string' },
          amount: { type: 'integer' },
          category: { type: 'string', enum: CATEGORY_NAMES },
        },
        required: ['item', 'amount', 'category'],
      },
    },
    city: { type: 'string', nullable: true },
    place: { type: 'string', nullable: true },
    dayOffset: { type: 'integer' },
  },
  required: ['items', 'dayOffset'],
};

function parsePrompt(text: string) {
  return `Bạn đọc tin nhắn ghi chi tiêu của một người Việt và trả về JSON.
Tin nhắn: """${text}"""

- items: mỗi khoản chi { item: tên ngắn gọn tiếng Việt, amount: số tiền VND (số nguyên), category: một trong ${CATEGORY_NAMES.join(', ')} }.
  Cách viết tiền: 45k = 45000, 1tr2 = 1200000, 1.5tr / 1,5 triệu = 1500000, 120.000 = 120000, "2 củ" = 2000000.
  Một tin có thể có nhiều khoản ("phở 45k, cafe 35k"). Nếu ghi "2 vé x 150k" thì amount = 300000.
- city: thành phố / tỉnh nơi chi tiêu NẾU tin nhắn có nêu địa điểm (dạng "ở Đà Lạt", "tại Hội An", "@Phú Quốc", hoặc tên quán kèm nơi chốn). Chuẩn hóa về tên thành phố/tỉnh phổ biến (VD "chợ đêm Đà Lạt" -> "Đà Lạt", "phố cổ Hội An" -> "Hội An", "Q1" / "Sài Gòn" -> "TP. Hồ Chí Minh"). null nếu không nêu.
- place: địa điểm cụ thể như người dùng viết (VD "chợ đêm Đà Lạt"), null nếu không có.
- dayOffset: 0 = hôm nay, -1 = hôm qua, -2 = hôm kia; chỉ đổi khi tin nhắn nói rõ.
Nếu tin nhắn không phải ghi chi tiêu thì items = [].`;
}

/** Gemini qua REST (không cần SDK). `image` = ảnh base64 gửi kèm. */
async function askGemini(env: Env, prompt: string, schema?: object, image?: { data: string; mime: string }, temperature = 0.3): Promise<string> {
  if (!env.GEMINI_API_KEY) throw new Error('Thiếu GEMINI_API_KEY');
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [...(image ? [{ inline_data: { mime_type: image.mime, data: image.data } }] : []), { text: prompt }] }],
        generationConfig: schema
          ? { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 }
          : { temperature },
      }),
      signal: AbortSignal.timeout(image ? 45_000 : 30_000),
    },
  );
  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${data.error?.message ?? ''}`);
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
}

/** Dự phòng: Cloudflare Workers AI qua binding (không cần key). */
async function askWorkersAi(env: Env, prompt: string, json: boolean): Promise<string> {
  const result = (await env.AI.run(FALLBACK_MODEL as Parameters<Ai['run']>[0], {
    messages: [{ role: 'user', content: json ? `${prompt}\nChỉ trả về JSON.` : prompt }],
    max_tokens: 2000,
  } as never)) as { response?: unknown; choices?: { message?: { content?: string } }[] };
  const output = result.response ?? result.choices?.[0]?.message?.content ?? '';
  return typeof output === 'string' ? output : JSON.stringify(output);
}

/** Lấy phần JSON (model hay bọc trong ```json ... ```). */
const jsonPart = (text: string) => text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);

function cleanParsed(raw: Partial<Parsed>, text: string): Parsed {
  const items = (raw.items ?? [])
    .filter((i) => i && typeof i.item === 'string' && Number(i.amount) > 0)
    .map((i) => ({ item: i.item.trim().slice(0, 80), amount: Math.round(Number(i.amount)), category: toCategory(i.category) }));
  const offset = Math.trunc(Number(raw.dayOffset) || 0);
  const city = typeof raw.city === 'string' && raw.city.trim() ? raw.city.trim().slice(0, 60) : null;
  const place = typeof raw.place === 'string' && raw.place.trim() ? raw.place.trim().slice(0, 80) : city;
  // Không tin địa điểm nếu tin nhắn không có dấu hiệu nào về nơi chốn (AI đôi khi tự đoán).
  const mentionsPlace = /@|\bở\b|\btại\b|\bđi\b/i.test(text) || (city !== null && text.toLowerCase().includes(city.toLowerCase().split(' ').pop() ?? '~'));
  return { items, city: mentionsPlace ? city : null, place: mentionsPlace ? place : null, dayOffset: Math.max(-30, Math.min(0, offset)) };
}

/** Đọc tin nhắn chi tiêu: Gemini -> Workers AI -> bộ đọc đơn giản. */
export async function parseExpense(env: Env, text: string): Promise<Parsed & { source: string }> {
  const prompt = parsePrompt(text);
  try {
    return { ...cleanParsed(JSON.parse(await askGemini(env, prompt, PARSE_SCHEMA)), text), source: 'gemini' };
  } catch (error) {
    console.error('[parse] Gemini lỗi:', error);
  }
  try {
    return { ...cleanParsed(JSON.parse(jsonPart(await askWorkersAi(env, prompt, true))), text), source: 'workers-ai' };
  } catch (error) {
    console.error('[parse] Workers AI lỗi:', error);
  }
  return { ...fallbackParse(text), source: 'fallback' };
}

/** Hỏi AI lấy văn bản: Gemini -> Workers AI. */
export async function askText(env: Env, prompt: string, tag: string, temperature?: number): Promise<string> {
  try {
    return (await askGemini(env, prompt, undefined, undefined, temperature)).trim();
  } catch (error) {
    console.error(`[${tag}] Gemini lỗi:`, error);
    return (await askWorkersAi(env, prompt, false)).trim();
  }
}

/** Hỏi AI lấy JSON theo schema: Gemini -> Workers AI. Lỗi cả hai thì ném lỗi. */
export async function askJson<T>(env: Env, prompt: string, schema: object, tag: string): Promise<T> {
  try {
    return JSON.parse(await askGemini(env, prompt, schema)) as T;
  } catch (error) {
    console.error(`[${tag}] Gemini lỗi:`, error);
  }
  return JSON.parse(jsonPart(await askWorkersAi(env, prompt, true))) as T;
}

/** Trả lời câu hỏi về chi tiêu dựa trên dữ liệu đã tổng hợp sẵn (không cho AI tự tính từ trí nhớ). */
export async function answerQuestion(env: Env, question: string, summary: string, context: string): Promise<string> {
  const prompt = `Bạn là trợ lý chi tiêu cá nhân, trả lời tiếng Việt ngắn gọn (tối đa 6 dòng), có số liệu cụ thể.
Chỉ dùng dữ liệu dưới đây; nếu không đủ dữ liệu thì nói rõ. Tiền viết dạng 45k, 1,2tr.
Câu hỏi về tổng tiền theo kỳ (hôm nay, 7 ngày, tuần này, tháng này, tháng trước) hoặc danh mục: LẤY SỐ TỪ PHẦN TỔNG HỢP, không tự cộng lại.
Viết văn bản thuần, có viết hoa bình thường, không dùng markdown (không **, không #); liệt kê thì mỗi ý một dòng bắt đầu bằng "• ".

TỔNG HỢP (đã tính sẵn, chính xác):
${summary}

CHI TIẾT TỪNG KHOẢN (mỗi dòng: ngày | khoản | danh mục | số tiền VND | thành phố | chuyến):
${context}

CÂU HỎI: ${question}`;
  const answer = await askText(env, prompt, 'ask', 0);
  // Phòng khi model vẫn trả markdown.
  return answer
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[*-]\s+/gm, '• ')
    .replace(/^#+\s*/gm, '')
    .trim();
}

const IMAGE_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['receipt', 'transfer', 'other'] },
    items: PARSE_SCHEMA.properties.items,
    date: { type: 'string', nullable: true },
    city: { type: 'string', nullable: true },
    place: { type: 'string', nullable: true },
  },
  required: ['kind', 'items'],
};

/**
 * Đọc ảnh hóa đơn / ảnh chụp chuyển khoản. Mặc định gộp cả hóa đơn thành 1 khoản (tổng thanh toán);
 * caption có chữ "tách" thì tách từng món. Địa điểm chỉ giữ khi caption có nhắc nơi chốn (tránh địa chỉ trụ sở in trên bill tạo chuyến đi giả).
 */
export async function parseImage(env: Env, image: { data: string; mime: string }, caption: string, today: string): Promise<Parsed & { kind: string }> {
  const split = /\btách\b/i.test(caption);
  const prompt = `Ảnh này là hóa đơn / biên lai mua hàng, hoặc ảnh chụp màn hình chuyển khoản ngân hàng / ví điện tử (MoMo, ZaloPay...) của một người Việt. Hôm nay là ${today}.
${caption ? `Người dùng ghi chú kèm ảnh: """${caption}"""` : ''}

Trả về JSON:
- kind: "receipt" (hóa đơn), "transfer" (chuyển khoản / thanh toán ví), "other" (không phải chứng từ chi tiêu).
- items: ${
    split
      ? 'MỖI MÓN trên hóa đơn một khoản (giá sau giảm giá của món đó).'
      : 'MỘT khoản duy nhất: item = tên cửa hàng / quán hoặc mô tả ngắn (VD "Highlands Coffee", "Bách Hóa Xanh"), amount = TỔNG THANH TOÁN cuối cùng (sau giảm giá, đã gồm VAT/phí).'
  }
  Chuyển khoản: amount = số tiền chuyển (không tính phí), item = nội dung chuyển khoản nếu rõ nghĩa, không thì "Chuyển khoản cho <tên người nhận>".
  category: một trong ${CATEGORY_NAMES.join(', ')}. amount là số nguyên VND.
  Ghi chú của người dùng (nếu có) được ưu tiên để đặt tên / danh mục.
  kind = "other" thì items = [].
- date: ngày giao dịch trên ảnh dạng YYYY-MM-DD, null nếu không thấy.
- city: thành phố / tỉnh của cửa hàng nếu thấy địa chỉ, null nếu không. place: tên địa điểm, null nếu không.`;
  const raw = JSON.parse(await askGemini(env, prompt, IMAGE_SCHEMA, image)) as Partial<Parsed> & { kind?: string; date?: string | null };
  // Ngày trên ảnh -> dayOffset (chỉ nhận trong 30 ngày qua).
  let dayOffset = 0;
  if (typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
    const diff = daysBetween(today, raw.date);
    if (diff <= 0 && diff >= -30) dayOffset = diff;
  }
  return { ...cleanParsed({ ...raw, dayOffset }, caption), kind: raw.kind ?? 'other' };
}

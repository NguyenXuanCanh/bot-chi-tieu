// Server Telegram giả để test trên máy: nhận sendMessage và in ra (kèm lưu vào file).
// getFile + /file/... trả ảnh trong thư mục argv[3] (file_id = tên file) để test gửi ảnh hóa đơn.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const out = process.argv[2] || '/tmp/tg-sent.jsonl';
const files = process.argv[3] || '.';
fs.writeFileSync(out, '');
let nextId = 9000;
http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.includes('/file/')) {
        const file = path.join(files, path.basename(url.pathname));
        if (!fs.existsSync(file)) return res.writeHead(404).end();
        return res.end(fs.readFileSync(file));
      }
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname.endsWith('/getFile')) {
        return res.end(JSON.stringify({ ok: true, result: { file_path: `photos/${url.searchParams.get('file_id')}` } }));
      }
      if (url.pathname.endsWith('/sendMessage')) fs.appendFileSync(out, body + '\n');
      res.end(JSON.stringify({ ok: true, result: { message_id: ++nextId } }));
    });
  })
  .listen(8799, () => console.log('mock telegram on :8799 ->', out));

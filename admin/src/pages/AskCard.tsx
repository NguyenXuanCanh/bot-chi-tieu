import { Loader2, MessageCircleQuestion, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Button, Card, CardTitle, ErrorBox, Input } from '../components/ui';
import { api } from '../lib/api';

const SUGGESTIONS = ['Tháng này ăn uống hết bao nhiêu?', 'Tuần này tiêu nhiều nhất vào gì?', 'So với tháng trước tháng này chi thế nào?', 'Khoản nào nên cắt bớt?'];

type QA = { question: string; answer: string };

/** Hỏi AI về chi tiêu, giống lệnh /hoi trên bot (dữ liệu 3 tháng gần nhất). Lịch sử chỉ giữ trong phiên. */
export function AskCard() {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<QA[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setError('');
    try {
      const { answer } = await api<{ answer: string }>('/ask', { method: 'POST', body: { question: q } });
      setHistory((h) => [{ question: q, answer }, ...h].slice(0, 10));
      setQuestion('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(question);
  };

  return (
    <Card>
      <CardTitle>
        <span className="inline-flex items-center gap-2">
          <MessageCircleQuestion className="size-4 text-primary" aria-hidden /> Hỏi về chi tiêu
        </span>
      </CardTitle>
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="ask-input" className="sr-only">
          Câu hỏi
        </label>
        <Input
          id="ask-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="VD: tháng này cà phê hết bao nhiêu?"
          maxLength={300}
          autoComplete="off"
          disabled={busy}
        />
        <Button type="submit" loading={busy} disabled={!question.trim()} aria-label="Hỏi">
          {busy ? null : <Send className="size-4" aria-hidden />}
          <span className="hidden sm:inline">Hỏi</span>
        </Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => ask(s)}
            disabled={busy}
            className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:border-secondary hover:text-foreground disabled:opacity-50">
            {s}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorBox message={error} />
        </div>
      ) : null}
      {busy ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> AI đang xem dữ liệu chi tiêu…
        </p>
      ) : null}
      {history.length ? (
        <ul className="mt-3 flex flex-col gap-3" aria-live="polite">
          {history.map((h, i) => (
            <li key={`${i}-${h.question}`} className="rounded-lg border border-border bg-background p-3">
              <p className="text-sm font-semibold">{h.question}</p>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-800">{h.answer}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">Dựa trên chi tiêu 3 tháng gần nhất, giống lệnh /hoi trên bot.</p>
    </Card>
  );
}

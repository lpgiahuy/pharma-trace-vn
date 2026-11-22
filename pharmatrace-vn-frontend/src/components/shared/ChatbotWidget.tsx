'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MessageCircle, Pill, Send, Siren, Stethoscope, X } from 'lucide-react';
import { chatbotErrorMessage, chatbotService, ChatbotReply, ChatTurn } from '@/services/chatbot.service';
import { cn, formatCurrency } from '@/utils';

type Message =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; text: string; reply?: ChatbotReply; error?: boolean };

const SUGGESTIONS = [
  'I have a runny nose, stuffy nose and a mild fever',
  'What can I take for a mild headache?',
  'My 5-year-old has a cough',
  'I have stomach pain and heartburn',
];

const GREETING =
  'Hello! I’m the PharmaTrace VN medicine assistant. Describe your symptoms or condition and I’ll suggest suitable products from our store.';

function ProductCard({ product }: { product: ChatbotReply['products'][number] }) {
  return (
    <Link
      href={`/products/${product.slug || product.id}`}
      className="flex gap-3 rounded-xl border border-slate-200 bg-white p-2.5 hover:border-blue-300 hover:shadow-sm transition"
    >
      <div className="h-14 w-14 shrink-0 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={product.imageUrl || '/favicon.ico'} alt="" className="max-h-full max-w-full object-contain" loading="lazy" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-slate-800 line-clamp-2 leading-snug">{product.name}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-[13px] font-bold text-blue-700 tabular-nums">{formatCurrency(product.price)}</span>
          {product.requiresPrescription && (
            <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-white">
              Prescription required
            </span>
          )}
        </div>
        {product.reason && <p className="mt-1 text-xs text-slate-500 leading-snug">{product.reason}</p>}
      </div>
    </Link>
  );
}

function AssistantBubble({ message, onFollowUp, busy }: { message: Extract<Message, { role: 'assistant' }>; onFollowUp: (q: string) => void; busy: boolean }) {
  const { reply } = message;
  return (
    <div className="max-w-[92%] space-y-2">
      {reply?.emergency && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-rose-800">
          <Siren className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm font-semibold leading-snug">{message.text}</p>
        </div>
      )}
      {!reply?.emergency && (
        <div
          className={cn(
            'whitespace-pre-line rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm leading-relaxed',
            message.error ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-slate-100 text-slate-800',
          )}
        >
          {message.text}
        </div>
      )}
      {reply && reply.products.length > 0 && (
        <div className="space-y-2">
          {reply.products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
      {reply?.needsDoctor && !reply.emergency && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
          <Stethoscope className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Please talk to a doctor or pharmacist before taking any medicine in this situation.</span>
        </div>
      )}
      {reply && reply.followUpQuestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {reply.followUpQuestions.map((q) => (
            <button
              key={q}
              type="button"
              disabled={busy}
              onClick={() => onFollowUp(q)}
              className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}
      {reply && !reply.emergency && <p className="text-[11px] leading-snug text-slate-400">{reply.disclaimer}</p>}
    </div>
  );
}

export const ChatbotWidget: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy, open]);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    const history: ChatTurn[] = messages
      .filter((m) => !(m.role === 'assistant' && m.error))
      // The follow-up chips are part of what the assistant said, so send them back: the server uses them to avoid repeating a question.
      .map((m) => ({
        role: m.role,
        content: m.role === 'assistant' && m.reply?.followUpQuestions.length ? `${m.text}\n${m.reply.followUpQuestions.join('\n')}` : m.text,
      }));
    setMessages((prev) => [...prev, { id: nextId.current++, role: 'user', text }]);
    setInput('');
    setBusy(true);
    try {
      const reply = await chatbotService.ask(text, history);
      setMessages((prev) => [...prev, { id: nextId.current++, role: 'assistant', text: reply.answer, reply }]);
    } catch (err) {
      setMessages((prev) => [...prev, { id: nextId.current++, role: 'assistant', text: chatbotErrorMessage(err), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open the medicine assistant"
          title="Ask about medicine"
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:scale-105 hover:bg-blue-700"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="Medicine assistant"
          className="fixed inset-x-0 bottom-0 z-50 flex h-[78vh] flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[600px] sm:w-[400px] sm:rounded-2xl"
        >
          <header className="flex items-center justify-between bg-blue-600 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Pill className="h-5 w-5" />
              <div>
                <p className="text-sm font-bold leading-tight">Medicine assistant</p>
                <p className="text-[11px] leading-tight text-blue-100">For reference only, not a substitute for a doctor</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-1 hover:bg-blue-500">
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto bg-white px-3 py-3">
            <div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-slate-100 px-3.5 py-2.5 text-sm leading-relaxed text-slate-800">{GREETING}</div>
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-100"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-tr-sm bg-blue-600 px-3.5 py-2.5 text-sm leading-relaxed text-white">{m.text}</div>
                </div>
              ) : (
                <AssistantBubble key={m.id} message={m} busy={busy} onFollowUp={(q) => void send(q)} />
              ),
            )}
            {busy && (
              <div className="flex w-fit items-center gap-1 rounded-2xl rounded-tl-sm bg-slate-100 px-3.5 py-3" aria-label="Assistant is typing">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form
            className="flex items-end gap-2 border-t border-slate-200 bg-white p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              maxLength={600}
              placeholder="Describe your symptoms…"
              className="max-h-28 min-h-[40px] flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={busy || input.trim().length < 2}
              aria-label="Send"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </section>
      )}
    </>
  );
};

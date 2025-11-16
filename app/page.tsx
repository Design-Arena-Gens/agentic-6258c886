"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type SearchResult = { title: string; url: string; snippet: string };

type Source = { type: "web" | "pdf"; title: string; url?: string; text: string };

async function searchWeb(query: string): Promise<SearchResult[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  return res.json();
}

async function fetchPage(url: string): Promise<{ title: string; text: string } | null> {
  try {
    const res = await fetch(`/api/fetch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function parsePdf(file: File): Promise<{ name: string; text: string } | null> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/pdf-parse", { method: "POST", body: fd });
  if (!res.ok) return null;
  return res.json();
}

function chunkText(text: string, chunkSize = 1600, overlap = 200): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks;
}

function rankChunksByQuery(chunks: string[], query: string, k = 5): string[] {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const scored = chunks.map((c, idx) => {
    const lc = c.toLowerCase();
    let score = 0;
    for (const t of terms) {
      const occurrences = lc.split(t).length - 1;
      score += occurrences;
    }
    return { idx, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(s => chunks[s.idx]);
}

export default function Page() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoBrowse, setAutoBrowse] = useState(true);
  const [sources, setSources] = useState<Source[]>([]);
  const [status, setStatus] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // WebLLM lazy setup
  const [llmReady, setLlmReady] = useState(false);
  const engineRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("Loading AI model (first time may take a minute)...");
      try {
        const webllm = await import("@mlc-ai/web-llm");
        const { CreateMLCEngine } = webllm as any;
        const model = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
        const engine = await CreateMLCEngine({
          model,
          gpuMemoryUtilization: 0.8
        });
        if (!cancelled) {
          engineRef.current = engine;
          setLlmReady(true);
          setStatus("");
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setStatus("AI load failed. Try refresh or use smaller device.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSend = async () => {
    const content = input.trim();
    if (!content || busy) return;
    setInput("");
    const userMsg: ChatMessage = { role: "user", content };
    setMessages(prev => [...prev, userMsg]);
    setBusy(true);

    // Gather context from web and PDFs
    let ctxPieces: Source[] = [];

    if (autoBrowse) {
      setStatus("Searching the web...");
      const results = await searchWeb(content);
      const top = results.slice(0, 3);
      const fetched: (Source | null)[] = await Promise.all(top.map(async (r) => {
        const page = await fetchPage(r.url);
        if (!page) return null;
        return { type: "web", title: page.title || r.title || r.url, url: r.url, text: page.text } as Source;
      }));
      ctxPieces.push(...(fetched.filter(Boolean) as Source[]));
    }

    // Include uploaded PDFs already in sources state
    const pdfs = sources.filter(s => s.type === "pdf");
    if (pdfs.length > 0) {
      const pdfText = pdfs.map(p => p.text).join("\n\n");
      const chunks = chunkText(pdfText);
      const topChunks = rankChunksByQuery(chunks, content, 5);
      ctxPieces.push({ type: "pdf", title: "Relevant PDF excerpts", text: topChunks.join("\n\n---\n\n") });
    }

    const system = `You are an expert AI assistant. Answer succinctly and cite sources as [1], [2], etc when web context is provided. If unsure, state the uncertainty.`;

    // Build context string with numbered citations
    const numbered = ctxPieces.map((s, i) => {
      const header = s.type === "web" ? `${i + 1}. ${s.title}${s.url ? ` (${s.url})` : ""}` : `${i + 1}. ${s.title}`;
      return `${header}\n${s.text.slice(0, 8000)}`;
    }).join("\n\n");

    const prompt = ctxPieces.length > 0
      ? `${system}\n\nContext Sources:\n${numbered}\n\nUser question: ${content}\n\nWrite the best answer. Include citations like [n] next to claims that come from sources.`
      : `${system}\n\nUser: ${content}\nAssistant:`;

    try {
      setStatus("Thinking...");
      let reply = "";
      if (engineRef.current && engineRef.current.chat && engineRef.current.chat.completions) {
        const resp = await engineRef.current.chat.completions.create({
          messages: [
            { role: "system", content: system },
            ...messages,
            userMsg,
            { role: "user", content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 600
        });
        reply = resp.choices?.[0]?.message?.content || "";
      } else if (engineRef.current && engineRef.current.generate) {
        // Fallback to generic generate
        reply = await engineRef.current.generate(prompt, { temperature: 0.2, maxTokens: 600 });
      } else {
        reply = "AI not ready. Please wait for model to load.";
      }

      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
      setStatus("");
      if (ctxPieces.length > 0) setSources(prev => [...prev, ...ctxPieces.filter(s => s.type === "web")]);
    } catch (e) {
      console.error(e);
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, there was an error generating a response." }]);
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setStatus("Parsing PDF(s)...");
    const results = await Promise.all(Array.from(files).map(parsePdf));
    const ok = results.filter(Boolean) as { name: string; text: string }[];
    const pdfSources: Source[] = ok.map(o => ({ type: "pdf", title: o.name, text: o.text }));
    setSources(prev => [...prev, ...pdfSources]);
    setStatus("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, height: '100vh' }}>
      <main style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>Agentic Chat</h1>
          <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={autoBrowse} onChange={e => setAutoBrowse(e.target.checked)} /> Auto Browse
          </label>
          <input ref={fileInputRef} type="file" accept="application/pdf" multiple onChange={handleUpload} style={{ fontSize: 12 }} />
        </div>
        <div style={{ flex: 1, overflow: 'auto', background: '#0e1526', border: '1px solid #1f2a44', borderRadius: 8, padding: 12 }}>
          {messages.length === 0 ? (
            <div style={{ opacity: 0.8, fontSize: 14 }}>
              Ask a question. Toggle Auto Browse to let the AI search the web. Upload PDFs to include them in answers.
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{m.role.toUpperCase()}</div>
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{m.content}</div>
              </div>
            ))
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
            placeholder={llmReady ? "Type your message..." : status || "Loading AI model..."}
            disabled={!llmReady || busy}
            style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid #1f2a44', background: '#0e1526', color: '#e6e6e6' }}
          />
          <button onClick={handleSend} disabled={!llmReady || busy || !input.trim()} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #1f2a44', background: '#1a2440', color: '#e6e6e6' }}>
            Send
          </button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>{status}</div>
      </main>
      <aside style={{ borderLeft: '1px solid #1f2a44', height: '100%', padding: 16, overflow: 'auto' }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Sources</h3>
        {sources.length === 0 ? (
          <div style={{ fontSize: 13, opacity: 0.8 }}>No sources yet.</div>
        ) : (
          sources.map((s, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {s.type === 'web' ? 'Web' : 'PDF'}: {s.title}
              </div>
              {s.url && (
                <a href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#9ecbff' }}>{s.url}</a>
              )}
            </div>
          ))
        )}
      </aside>
    </div>
  );
}

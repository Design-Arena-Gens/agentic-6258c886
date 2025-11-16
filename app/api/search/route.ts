import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const dynamic = "force-dynamic";

function toAbsoluteUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `https://duckduckgo.com${url}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  if (!q) return NextResponse.json([], { status: 200 });
  try {
    const res = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AgenticBot/1.0; +https://example.com/bot)",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    const items: { title: string; url: string; snippet: string }[] = [];
    $("a.result__a").each((_, el) => {
      const a = $(el);
      const title = a.text();
      const href = toAbsoluteUrl(a.attr("href") || "");
      const snippet = a.parent().find(".result__snippet").text() || "";
      if (href) items.push({ title, url: href, snippet });
    });
    return NextResponse.json(items.slice(0, 10));
  } catch (e) {
    return NextResponse.json([], { status: 200 });
  }
}

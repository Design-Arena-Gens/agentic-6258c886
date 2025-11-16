import { NextRequest, NextResponse } from "next/server";
import { JSDOM } from "jsdom";
// @ts-ignore
import { Readability } from "@mozilla/readability";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") return NextResponse.json({ error: "Invalid URL" }, { status: 400 });

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AgenticBot/1.0; +https://example.com/bot)",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    const title = article?.title || dom.window.document.title || url;
    const text = article?.textContent || dom.window.document.body.textContent || "";
    return NextResponse.json({ title, text });
  } catch (e) {
    return NextResponse.json({ title: "", text: "" }, { status: 200 });
  }
}

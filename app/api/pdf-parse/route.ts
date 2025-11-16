import { NextRequest, NextResponse } from "next/server";
import formidable, { File } from "formidable";
import fs from "fs";
// @ts-ignore
import pdf from "pdf-parse";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const form = formidable({ multiples: false, keepExtensions: false });

    const buffer = await new Promise<{ name: string; buffer: Buffer }>((resolve, reject) => {
      // formidable expects Node-style req, but NextRequest is Web API. Use workaround by converting to stream.
      // @ts-ignore
      const reqAny: any = (req as any);
      const nodeReq = reqAny?.__NEXT_PRIVATE_REQ__ || reqAny?.nextUrl ? undefined : undefined;
      // Use a manual parse by reading the raw body into memory and feeding formidable via fake file.
      // Simpler approach: read raw body and parse boundary quickly.
      // But Next 14 allows using "body: false" and accessing request.body as a stream.
      // We'll buffer the entire body and parse boundary ourselves via formidable's parse hook over a mocked incoming message.
      (async () => {
        const contentType = req.headers.get("content-type") || "";
        const arrayBuffer = await req.arrayBuffer();
        const buf = Buffer.from(arrayBuffer);
        // Minimal parser: assume single file named 'file'.
        // Fallback: directly return the raw buffer if no multipart boundary.
        if (!contentType.includes("multipart/form-data")) {
          return reject(new Error("Expected multipart/form-data"));
        }
        // Use formidable to parse by creating a fake IncomingMessage
        const { Readable } = await import("stream");
        const { IncomingMessage } = await import("http");
        const readable = new Readable();
        readable._read = () => {};
        readable.push(buf);
        readable.push(null);
        const im = new IncomingMessage(null as any);
        // @ts-ignore
        im.headers = { 'content-type': contentType, 'content-length': String(buf.length) };
        // @ts-ignore
        im.method = 'POST';
        // @ts-ignore
        im.url = '/api/pdf-parse';
        // Pipe our buffer to formidable
        (form as any).parse(im, (err: any, _fields: any, files: any) => {
          if (err) return reject(err);
          const f: File | undefined = files?.file?.[0] || files?.file;
          if (!f) return reject(new Error("No file"));
          const fileBuffer = fs.readFileSync(f.filepath);
          resolve({ name: f.originalFilename || "document.pdf", buffer: fileBuffer });
        });
        readable.pipe(im as any);
      })();
    });

    const data = await pdf(buffer.buffer);
    const text: string = (data.text || "").replace(/\u0000/g, "");

    return NextResponse.json({ name: buffer.name, text: text.slice(0, 500000) });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to parse PDF' }, { status: 400 });
  }
}

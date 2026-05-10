import { NextResponse } from "next/server";
import { createAnalysisJob } from "@/lib/competitor-analysis";

const MAX_URLS = 10;
const HARDCODED_MODEL = "gemini-2.5-flash";

function isHttpUrl(url: string) {
  return url.startsWith("http://") || url.startsWith("https://");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
    const rawUrls = Array.isArray(body?.urls) ? body.urls : [];
    const urls = rawUrls
      .filter((u: unknown) => typeof u === "string")
      .map((u: string) => u.trim())
      .filter(Boolean);

    const context = typeof body?.context === "string" ? body.context.trim() : undefined;

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    if (!urls.length) {
      return NextResponse.json({ error: "urls cannot be empty" }, { status: 400 });
    }

    if (urls.length > MAX_URLS) {
      return NextResponse.json({ error: `Maximum ${MAX_URLS} URLs per request` }, { status: 400 });
    }

    for (const url of urls) {
      if (!isHttpUrl(url)) {
        return NextResponse.json({ error: `Invalid URL (must start with http:// or https://): ${url}` }, { status: 400 });
      }
    }

    const job = createAnalysisJob({ userId, urls, context, model: HARDCODED_MODEL });

    return NextResponse.json(
      {
        status: "accepted",
        jobId: job.id,
        urls,
        message: `Analysing ${urls.length} competitor(s). Poll /api/competitor-analysis/${job.id} for results.`,
      },
      { status: 202 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request body" },
      { status: 400 },
    );
  }
}

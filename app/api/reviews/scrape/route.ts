import { NextResponse } from "next/server";
import { createReviewsScrapeJob } from "@/lib/reviews-scraper";

const DEFAULT_URL = "https://www.producthunt.com/products/jira/reviews?filter=all&feed=single&page=1";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const rawUrls = Array.isArray(body?.urls) ? body.urls : [];
  const urls = rawUrls
    .filter((value: unknown) => typeof value === "string")
    .map((value: string) => value.trim())
    .filter(Boolean);

  const candidateUrls = urls.length ? urls : [typeof body?.url === "string" ? body.url.trim() : DEFAULT_URL];

  for (const url of candidateUrls) {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return NextResponse.json({ error: `Invalid URL: ${url}` }, { status: 400 });
    }
    if (!/producthunt\.com\/products\/.+\/reviews/i.test(url)) {
      return NextResponse.json({ error: `URL must be a Product Hunt reviews URL: ${url}` }, { status: 400 });
    }
  }

  const job = createReviewsScrapeJob(candidateUrls);

  return NextResponse.json({
    status: "accepted",
    jobId: job.id,
    sourceUrls: job.sourceUrls,
    message: "Reviews scrape started. Poll the job endpoint for progress.",
  }, { status: 202 });
}

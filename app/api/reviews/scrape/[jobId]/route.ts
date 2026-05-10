import { NextResponse } from "next/server";
import { getReviewsScrapeJob } from "@/lib/reviews-scraper";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getReviewsScrapeJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json(job);
}

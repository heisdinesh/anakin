import { NextResponse } from "next/server";
import { getAnalysisJob } from "@/lib/competitor-analysis";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getAnalysisJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    progressMessage: job.progressMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    input: job.input,
    result: job.result ?? null,
    error: job.error ?? null,
    metrics: job.result
      ? {
          competitors_analysed: job.result.competitors.length,
          features_suggested: job.result.featureSuggestions.length,
          opportunities_found: job.result.opportunities.length,
        }
      : null,
  });
}

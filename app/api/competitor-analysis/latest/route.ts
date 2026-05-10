import { NextResponse } from "next/server";
import { getLatestAnalysisForUser } from "@/lib/competitor-analysis";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = (searchParams.get("userId") ?? "").trim();

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const latest = await getLatestAnalysisForUser(userId);
  if (!latest) {
    return NextResponse.json({ error: "No analysis found" }, { status: 404 });
  }

  return NextResponse.json({
    jobId: latest.jobId,
    status: "completed",
    progressMessage: "Analysis completed.",
    createdAt: latest.createdAt,
    updatedAt: latest.createdAt,
    input: {
      userId: latest.userId,
      urls: latest.urls,
      context: latest.context,
      model: latest.model,
    },
    result: latest.result,
    error: null,
    metrics: {
      competitors_analysed: latest.result.competitors.length,
      features_suggested: latest.result.featureSuggestions.length,
      opportunities_found: latest.result.opportunities.length,
    },
  });
}

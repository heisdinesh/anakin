import { NextResponse } from "next/server";
import { listAnalysisHistoryForUser } from "@/lib/competitor-analysis";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = (searchParams.get("userId") ?? "").trim();

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const items = await listAnalysisHistoryForUser(userId, 100);
  return NextResponse.json({
    status: "success",
    count: items.length,
    items: items.map((item) => ({
      jobId: item.jobId,
      createdAt: item.createdAt,
      input: {
        urls: item.urls,
        context: item.context,
        model: item.model,
      },
      result: item.result,
    })),
  });
}

import { NextResponse } from "next/server";
import { getComparisonData } from "@/lib/reviews-scraper";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = (searchParams.get("userId") ?? "").trim();
    if (!userId) {
      return NextResponse.json({ status: "error", error: "userId is required" }, { status: 400 });
    }

    const comparison = await getComparisonData(userId);
    return NextResponse.json({ status: "success", ...comparison });
  } catch (error) {
    return NextResponse.json({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

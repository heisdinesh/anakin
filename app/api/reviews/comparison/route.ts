import { NextResponse } from "next/server";
import { getComparisonData } from "@/lib/reviews-scraper";

export async function GET() {
  try {
    const comparison = await getComparisonData();
    return NextResponse.json({ status: "success", ...comparison });
  } catch (error) {
    return NextResponse.json({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

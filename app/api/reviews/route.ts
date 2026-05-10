import { NextResponse } from "next/server";
import { listStoredProductHuntReviews } from "@/lib/reviews-scraper";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "12");
    const competitor = searchParams.get("competitor") ?? undefined;

    const result = await listStoredProductHuntReviews(page, pageSize, competitor);
    return NextResponse.json({
      status: "success",
      count: result.reviews.length,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
      reviews: result.reviews,
    });
  } catch (error) {
    return NextResponse.json({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

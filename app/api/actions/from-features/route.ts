import { NextResponse } from "next/server";
import { createActionsFromFeatureSuggestions } from "@/lib/actions";
import type { CompetitorAnalysisResult } from "@/lib/competitor-analysis";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
    const suggestions = Array.isArray(body?.suggestions)
      ? (body.suggestions as CompetitorAnalysisResult["featureSuggestions"])
      : [];

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    if (!suggestions.length) {
      return NextResponse.json({ error: "At least one suggestion is required" }, { status: 400 });
    }

    const result = await createActionsFromFeatureSuggestions(userId, suggestions);
    return NextResponse.json({ status: "success", created: result.created });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { updateActionStatus } from "@/lib/actions";

export async function PATCH(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  const { actionId } = await params;
  const body = await request.json().catch(() => ({}));
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const status = body?.status;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (status !== "todo" && status !== "inprogress" && status !== "done") {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const updated = await updateActionStatus(userId, actionId, status);
  if (!updated) {
    return NextResponse.json({ error: "Action not found" }, { status: 404 });
  }

  return NextResponse.json({ status: "success", action: updated });
}

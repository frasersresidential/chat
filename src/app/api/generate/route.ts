import { NextResponse } from "next/server";
import { getProvider, type GenerationRequest } from "@/lib/ai/provider";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: Partial<GenerationRequest>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.studio || !body.prompt?.trim()) {
    return NextResponse.json(
      { error: "ต้องระบุ studio และ prompt" },
      { status: 400 }
    );
  }

  try {
    const result = await getProvider().generate({
      studio: body.studio,
      prompt: body.prompt,
      platform: body.platform,
      niche: body.niche,
      brandVoiceId: body.brandVoiceId,
      styleId: body.styleId,
      options: body.options,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("generate error:", err);
    const message = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

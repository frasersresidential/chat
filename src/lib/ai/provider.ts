import "server-only";

// จุดต่อ AI — ใช้ฝั่ง server เท่านั้น (เรียกผ่าน /api/generate)
//
// เลือก provider อัตโนมัติจาก env:
//   - มี ANTHROPIC_API_KEY → ใช้ Claude จริง (AnthropicProvider)
//   - ไม่มี                → ใช้ MockProvider (แอปยังรันได้โดยไม่ต้องมีคีย์)

import Anthropic from "@anthropic-ai/sdk";

export type GenerationRequest = {
  studio: string;
  prompt: string;
  platform?: string;
  niche?: string;
  brandVoiceId?: string;
  styleId?: string;
  options?: Record<string, unknown>;
};

export type GenerationResult = {
  id: string;
  text: string;
  creditsUsed: number;
  createdAt: string;
  /** ชื่อ provider ที่ใช้จริง — ให้ UI รู้ว่าเป็นของจริงหรือ mock */
  provider: string;
};

export interface GenerationProvider {
  readonly name: string;
  generate(req: GenerationRequest): Promise<GenerationResult>;
}

// สร้าง system prompt ตามแต่ละ Studio
function buildSystem(req: GenerationRequest): string {
  const base =
    "คุณเป็นผู้เชี่ยวชาญด้านคอนเทนต์โซเชียลมีเดียภาษาไทย เขียนคอนเทนต์ที่ดึงดูด " +
    "อ่านง่าย เป็นธรรมชาติ และกระตุ้นการมีส่วนร่วม โดยคำนึงถึงแพลตฟอร์มและกลุ่มเป้าหมาย " +
    "ตอบกลับเป็นภาษาไทยและพร้อมนำไปโพสต์ได้ทันที ไม่ต้องมีคำอธิบายนำหรือคำพูดเกริ่น";
  const perStudio: Record<string, string> = {
    "Content Studio":
      "เน้นคิดไอเดีย hook เปิดเรื่องที่ทำให้คนหยุดเลื่อน สคริปต์ และแคปชั่นที่กระชับ มีพลัง",
    "Viral Studio":
      "แปลงเทรนด์ที่กำลังมาแรงให้เป็นคอนเทนต์พร้อมถ่าย ทั้ง hook สคริปต์ และไอเดียภาพ",
    "Visual Studio":
      "อธิบายไอเดียภาพและ prompt สำหรับสร้างภาพประกอบโพสต์ให้ชัดเจน",
  };
  return `${base}\n\nบทบาทเฉพาะ: ${perStudio[req.studio] ?? perStudio["Content Studio"]}`;
}

function buildUserPrompt(req: GenerationRequest): string {
  const lines = [`โจทย์: ${req.prompt}`];
  if (req.platform) lines.push(`แพลตฟอร์ม: ${req.platform}`);
  if (req.niche) lines.push(`ประเภทธุรกิจ/Niche: ${req.niche}`);
  return lines.join("\n");
}

class AnthropicProvider implements GenerationProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const message = await this.client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: buildSystem(req),
      messages: [{ role: "user", content: buildUserPrompt(req) }],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    // คิดเครดิตจากจำนวน token ที่ output (ขั้นต่ำ 1)
    const creditsUsed = Math.max(1, Math.ceil(message.usage.output_tokens / 200));

    return {
      id: message.id,
      text: text || "(ไม่มีผลลัพธ์)",
      creditsUsed,
      createdAt: new Date().toISOString(),
      provider: this.name,
    };
  }
}

class MockProvider implements GenerationProvider {
  readonly name = "mock";

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    await new Promise((r) => setTimeout(r, 400));
    return {
      id: `gen_${Date.now()}`,
      text:
        `「ตัวอย่างผลลัพธ์จาก ${req.studio}」\n\n` +
        `โจทย์: ${req.prompt || "(ยังไม่ได้กรอก)"}\n` +
        `แพลตฟอร์ม: ${req.platform ?? "-"}\n\n` +
        `ระบบ AI จริงยังไม่ถูกต่อ (ยังไม่ได้ตั้ง ANTHROPIC_API_KEY) ` +
        `เมื่อตั้งคีย์แล้ว ข้อความส่วนนี้จะถูกแทนที่ด้วยคอนเทนต์ที่ Claude สร้างจริง`,
      creditsUsed: 3,
      createdAt: new Date().toISOString(),
      provider: this.name,
    };
  }
}

let cached: GenerationProvider | null = null;

export function getProvider(): GenerationProvider {
  if (cached) return cached;
  const key = process.env.ANTHROPIC_API_KEY;
  cached = key ? new AnthropicProvider(key) : new MockProvider();
  return cached;
}

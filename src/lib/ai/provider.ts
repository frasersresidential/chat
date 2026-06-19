// จุดต่อ AI สำหรับอนาคต (ตอนนี้ยังเป็น stub — ยังไม่ต่อจริง)
//
// แนวคิด: ทุก Studio เรียกผ่าน interface กลางตัวนี้ เวลาจะต่อโมเดลจริง
// (Claude / Gemini / ฯลฯ) ให้สร้าง provider ใหม่ที่ implement GenerationProvider
// แล้วสลับใน getProvider() — โดยไม่ต้องแก้หน้า UI

export type GenerationRequest = {
  studio: string;
  prompt: string;
  platform?: string;
  brandVoiceId?: string;
  styleId?: string;
  /** ตัวเลือกเพิ่มเติมเฉพาะแต่ละ Studio */
  options?: Record<string, unknown>;
};

export type GenerationResult = {
  id: string;
  text: string;
  /** เครดิตที่ใช้ไปกับงานนี้ */
  creditsUsed: number;
  createdAt: string;
};

export interface GenerationProvider {
  readonly name: string;
  generate(req: GenerationRequest): Promise<GenerationResult>;
}

// Provider ตัวอย่าง: คืนข้อความ mock เพื่อให้ UI ทำงานได้ก่อนต่อโมเดลจริง
class MockProvider implements GenerationProvider {
  readonly name = "mock";

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    // จำลองดีเลย์ของการเรียกโมเดล
    await new Promise((r) => setTimeout(r, 400));
    return {
      id: `gen_${Date.now()}`,
      text:
        `「ตัวอย่างผลลัพธ์จาก ${req.studio}」\n\n` +
        `โจทย์: ${req.prompt || "(ยังไม่ได้กรอก)"}\n` +
        `แพลตฟอร์ม: ${req.platform ?? "-"}\n\n` +
        `นี่คือผลลัพธ์ตัวอย่าง ระบบ AI จริงยังไม่ถูกต่อในเวอร์ชันนี้ ` +
        `เมื่อต่อโมเดลแล้ว ข้อความส่วนนี้จะถูกแทนที่ด้วยคอนเทนต์ที่ AI สร้างจริง`,
      creditsUsed: 3,
      createdAt: new Date().toISOString(),
    };
  }
}

// เลือก provider ที่ใช้งานจริง — ภายหลังอ่านจาก env เช่น process.env.AI_PROVIDER
export function getProvider(): GenerationProvider {
  return new MockProvider();
}

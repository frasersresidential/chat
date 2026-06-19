# Hero AI · Content Engine

โครงสร้างแดชบอร์ดสำหรับ **สร้างคอนเทนต์โซเชียลด้วย AI** (สไตล์ Hero AI) สร้างด้วย **Next.js (App Router) + TypeScript + Tailwind CSS**

> เวอร์ชันนี้วาง **โครงสร้างทั้งระบบ** และ **ต่อ AI จริงแล้ว** ด้วย Claude (Opus 4.8)
> ผ่าน Anthropic SDK — ถ้ายังไม่ตั้ง `ANTHROPIC_API_KEY` ระบบจะ fallback เป็นผลลัพธ์ตัวอย่าง (mock) ให้แอปรันได้

## เริ่มใช้งาน

```bash
npm install
npm run dev
```

เปิด http://localhost:3000

คำสั่งอื่น ๆ:

```bash
npm run build      # build production
npm run typecheck  # ตรวจ TypeScript
npm run lint       # ตรวจ lint
```

## โครงสร้างโปรเจกต์

```
src/
├── app/
│   ├── layout.tsx              root layout (ตั้งธีม, ฟอนต์)
│   ├── globals.css
│   └── (dashboard)/            กลุ่ม route ที่ใช้ sidebar + topbar
│       ├── layout.tsx          เลย์เอาต์หลัก
│       ├── page.tsx            Dashboard
│       ├── viral-studio/       หาเทรนด์ → ทำคอนเทนต์
│       ├── content-studio/     ไอเดีย · hook · สคริปต์ · แคปชั่น
│       ├── visual-studio/      สร้างภาพจากเทมเพลต
│       ├── inspiration/        แรงบันดาลใจ
│       ├── brand-voice/        ตั้งโทนแบรนด์
│       ├── style/              สไตล์ที่โคลนไว้
│       ├── works/              ผลงานของฉัน
│       ├── folders/            โฟลเดอร์
│       ├── calendar/           ปฏิทินคอนเทนต์
│       ├── saved-viral/        เทรนด์ที่บันทึก
│       ├── pricing/            ราคาแพ็กเกจ
│       ├── credits/            เครดิตของฉัน
│       └── referral/           แจกเครดิต
├── components/                 UI ที่ใช้ร่วมกัน (Sidebar, Topbar, การ์ด ฯลฯ)
└── lib/
    ├── nav.ts                  โครงสร้างเมนู (แก้ที่เดียว เมนูอัปเดตทั้งระบบ)
    ├── mock-data.ts            ข้อมูลตัวอย่าง
    └── ai/provider.ts          จุดต่อ AI (ตอนนี้เป็น mock)
```

## การต่อ AI (Claude)

ต่อกับ Claude ผ่าน Anthropic SDK เรียบร้อยแล้ว:

- `src/lib/ai/provider.ts` — interface กลาง + `AnthropicProvider` (Claude Opus 4.8, adaptive thinking) + `MockProvider`
- `src/app/api/generate/route.ts` — API route ฝั่ง server (คีย์ไม่หลุดไป client)
- หน้า Studio เรียกผ่าน `fetch('/api/generate')`

**เปิดใช้งาน AI จริง:**

```bash
cp .env.example .env.local
# แล้วใส่ ANTHROPIC_API_KEY=sk-ant-... (ขอที่ https://console.anthropic.com)
```

ถ้าไม่ตั้งคีย์ ระบบจะใช้ผลลัพธ์ตัวอย่าง (mock) แทนโดยอัตโนมัติ

**สลับไปโมเดล/ผู้ให้บริการอื่น** (เช่น Gemini): สร้าง class ใหม่ที่ implement `GenerationProvider`
แล้วเลือกใน `getProvider()` — ไม่ต้องแก้หน้า UI

## สิ่งที่ยังไม่ทำ (ขั้นต่อไป)

- ต่อ AI ในฝั่ง Visual Studio (สร้างภาพจริง)
- ระบบ auth / ผู้ใช้จริง
- ฐานข้อมูล (เก็บผลงาน, เครดิต, แบรนด์)
- drag & drop ในปฏิทินคอนเทนต์

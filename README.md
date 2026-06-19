# Hero AI · Content Engine

โครงสร้างแดชบอร์ดสำหรับ **สร้างคอนเทนต์โซเชียลด้วย AI** (สไตล์ Hero AI) สร้างด้วย **Next.js (App Router) + TypeScript + Tailwind CSS**

> เวอร์ชันนี้เป็น **โครงสร้างทั้งระบบ** ใช้ข้อมูลตัวอย่าง (mock) — ยังไม่ต่อ AI จริง มีจุดต่อ AI เตรียมไว้แล้วที่ `src/lib/ai/provider.ts`

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

## ต่อ AI จริงในอนาคต

1. สร้าง class ใหม่ที่ implement `GenerationProvider` ใน `src/lib/ai/provider.ts`
   (เช่นเรียก Claude / Gemini ผ่าน API route)
2. คืน provider นั้นใน `getProvider()` (อ่านค่าจาก env เช่น `AI_PROVIDER`)
3. หน้า UI ทุก Studio เรียกผ่าน interface กลางอยู่แล้ว — ไม่ต้องแก้

## สิ่งที่ยังไม่ทำ (ขั้นต่อไป)

- ต่อโมเดล AI จริง + API routes
- ระบบ auth / ผู้ใช้จริง
- ฐานข้อมูล (เก็บผลงาน, เครดิต, แบรนด์)
- drag & drop ในปฏิทินคอนเทนต์
- ระบบสร้างภาพใน Visual Studio

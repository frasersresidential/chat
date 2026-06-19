import { Icon } from "@/components/Icon";
import { visualTemplates } from "@/lib/mock-data";

export default function VisualStudioPage() {
  return (
    <div className="mx-auto max-w-3xl">
      {/* header */}
      <div className="mb-6 text-center">
        <h1 className="flex items-center justify-center gap-2 text-xl font-bold text-slate-900 dark:text-white">
          <Icon name="palette" className="h-5 w-5 text-brand-500" /> เจนรูปแบรนด์คุณ
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          พิมพ์ → โทน + รูปแบรนด์ดีอัตโนมัติ → ได้รูปพร้อมโพสต์
        </p>
      </div>

      {/* CTA ตั้งแบรนด์ */}
      <div className="mb-5 rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-6 text-center dark:border-brand-600/30 dark:from-brand-600/10 dark:to-slate-900">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600 dark:bg-brand-600/20">
          <Icon name="sparkles" className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-bold text-brand-700 dark:text-brand-300">
          ตั้งแบรนด์คุณใน 30 วินาที
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          ให้ AI สร้างรูปที่เป็น “คุณ” ทุกครั้งที่เจน
        </p>
        <p className="mt-1 text-xs text-slate-400">
          เพิ่ม โลโก้ · รูปคุณ · ป้ายร้าน · Banner → AI ใส่ลงเทมเพลตอัตโนมัติ
        </p>
        <button className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
          เริ่มตั้งค่าเลย <Icon name="arrow" className="h-4 w-4" />
        </button>
      </div>

      {/* prompt box */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex gap-3">
          <button className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-brand-400 hover:text-brand-500 dark:border-slate-700">
            <Icon name="plus" className="h-5 w-5" />
            <span className="text-[10px]">รูป ref</span>
          </button>
          <textarea
            rows={3}
            placeholder="พิมพ์เพื่ออธิบายรูปที่อยากได้… เช่น โปสเตอร์โปรโมชั่นร้านกาแฟ โทนอบอุ่น มีข้อความ ‘ลด 50%’"
            className="flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm outline-none focus:border-brand-400 dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        <p className="mt-3 text-xs text-slate-400">
          <Icon name="bulb" className="mr-1 inline h-3.5 w-3.5" />
          รูปธรรมดา — เร็วและประหยัดสุด · ไม่มีข้อความไทยในรูป · ไม่ใส่รูปอ้างอิง
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Chip icon="coin" label="การเงิน-ลงทุน" />
          <Chip icon="image" label="Nano Banana 1 เครดิต" />
          <Chip icon="grid" label="1:1" />
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-slate-400">ใช้ 1 · เหลือ 100</span>
            <button className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700">
              <Icon name="arrow" className="h-4 w-4 -rotate-90" />
            </button>
          </div>
        </div>
      </div>

      {/* เลือกจากเทมเพลต */}
      <details className="mt-4 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200">
          <span className="flex items-center gap-2">
            <Icon name="chevron" className="h-4 w-4 text-slate-400" />
            เลือกจากเทมเพลต <span className="text-slate-400">(72)</span>
          </span>
          <span className="text-xs text-brand-600">เปิดดู</span>
        </summary>
        <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-4 dark:border-slate-800">
          {visualTemplates.map((t) => (
            <div
              key={t.id}
              className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <div className="flex aspect-square items-center justify-center bg-gradient-to-br from-brand-100 to-brand-50 text-brand-300 dark:from-slate-800 dark:to-slate-900">
                <Icon name="image" className="h-6 w-6" />
              </div>
              <div className="truncate px-2 py-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                {t.name}
              </div>
            </div>
          ))}
        </div>
      </details>

      {/* ผลงานล่าสุด */}
      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900 dark:text-white">ผลงานล่าสุด</h2>
          <button className="flex items-center gap-1 text-xs text-brand-600">
            ดูทั้งหมด <Icon name="arrow" className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400 dark:border-slate-700">
          ยังไม่มีผลงาน — เริ่มเจนรูปแรกได้เลย ✨
        </div>
      </section>
    </div>
  );
}

function Chip({ icon, label }: { icon: string; label: string }) {
  return (
    <button className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
      <Icon name={icon} className="h-3.5 w-3.5 text-slate-400" />
      {label}
      <Icon name="chevron" className="h-3 w-3 rotate-90 text-slate-300" />
    </button>
  );
}

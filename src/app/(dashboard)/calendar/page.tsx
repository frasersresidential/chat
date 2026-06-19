import { PageHeader } from "@/components/PageHeader";

const weekdays = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];

// โพสต์ที่วางไว้ (mock) — key = วันที่ของเดือน
const scheduled: Record<number, { title: string; platform: string }[]> = {
  3: [{ title: "โปรเปิดร้าน", platform: "FB" }],
  7: [{ title: "Reel เทรนด์", platform: "TikTok" }],
  12: [
    { title: "รีวิวเมนูใหม่", platform: "IG" },
    { title: "Live ขายของ", platform: "FB" },
  ],
  18: [{ title: "Q&A ลูกค้า", platform: "IG" }],
  24: [{ title: "โปรสิ้นเดือน", platform: "FB" }],
};

export default function CalendarPage() {
  // เดือนตัวอย่าง 30 วัน เริ่มวันอังคาร (offset 1)
  const offset = 1;
  const days = Array.from({ length: 30 }, (_, i) => i + 1);

  return (
    <div>
      <PageHeader
        icon="calendar"
        title="ปฏิทินคอนเทนต์"
        description="วางแผนโพสต์รายเดือน · มิถุนายน 2026"
      />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800">
          {weekdays.map((d) => (
            <div
              key={d}
              className="py-2 text-center text-xs font-semibold text-slate-400"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: offset }).map((_, i) => (
            <div key={`pad-${i}`} className="min-h-24 border-b border-r border-slate-100 dark:border-slate-800" />
          ))}
          {days.map((d) => (
            <div
              key={d}
              className="min-h-24 border-b border-r border-slate-100 p-1.5 dark:border-slate-800"
            >
              <div className="mb-1 text-xs text-slate-400">{d}</div>
              <div className="space-y-1">
                {scheduled[d]?.map((p, i) => (
                  <div
                    key={i}
                    className="truncate rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-600/20 dark:text-brand-300"
                  >
                    {p.platform} · {p.title}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        * ตัวอย่างโครงสร้าง — ฟีเจอร์ลากปล่อยวัน (drag & drop) จะเพิ่มในขั้นต่อไป
      </p>
    </div>
  );
}

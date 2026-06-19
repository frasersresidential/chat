import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";
import { visualTemplates } from "@/lib/mock-data";

export default function VisualStudioPage() {
  return (
    <div>
      <PageHeader
        icon="image"
        title="Visual Studio"
        description="สร้างภาพแบบเทพ — เลือกจาก 72 เทมเพลต แล้วปรับแต่งได้"
        action={
          <button className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            <Icon name="plus" className="h-4 w-4" /> สร้างภาพใหม่
          </button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {visualTemplates.map((t) => (
          <button
            key={t.id}
            className="group overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-brand-100 to-brand-50 text-brand-300 dark:from-slate-800 dark:to-slate-900">
              <Icon name="image" className="h-8 w-8" />
            </div>
            <div className="p-3">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {t.name}
              </div>
              <div className="text-xs text-slate-400">{t.category}</div>
            </div>
          </button>
        ))}
      </div>

      <p className="mt-6 text-center text-sm text-slate-400">
        + อีก {72 - visualTemplates.length} เทมเพลต (ตัวอย่างโครงสร้าง — ยังไม่ต่อระบบสร้างภาพจริง)
      </p>
    </div>
  );
}

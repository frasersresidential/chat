import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";
import { trends } from "@/lib/mock-data";

export default function SavedViralPage() {
  return (
    <div>
      <PageHeader
        icon="bookmark"
        title="Viral ที่บันทึก"
        description="เทรนด์ที่เก็บไว้ พร้อมหยิบมาทำคอนเทนต์เมื่อไหร่ก็ได้"
      />
      <div className="space-y-3">
        {trends.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-500 dark:bg-orange-500/10">
              <Icon name="flame" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                {t.title}
              </div>
              <div className="text-xs text-slate-400">
                ใช้ {t.uses} ครั้ง · {t.category}
              </div>
            </div>
            <button className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
              สร้างคอนเทนต์
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

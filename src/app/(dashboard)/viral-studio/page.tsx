import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { StudioWorkspace } from "@/components/StudioWorkspace";
import { Icon } from "@/components/Icon";
import { trends } from "@/lib/mock-data";

export default function ViralStudioPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon="flame"
        title="Viral Studio"
        description="หาเทรนด์ดัง · มาแรง แล้วแปลงเป็นคอนเทนต์พร้อมถ่าย"
      />

      {/* เทรนด์ที่มาแรงตอนนี้ */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
          <Icon name="flame" className="h-5 w-5 text-orange-500" /> เทรนด์มาแรงตอนนี้
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {trends.map((t) => (
            <div
              key={t.id}
              className="rounded-lg border border-slate-200 p-3 transition-colors hover:border-brand-300 dark:border-slate-700"
            >
              <div className="mb-1 text-sm font-medium text-slate-800 dark:text-slate-100">
                {t.title}
              </div>
              <div className="text-xs text-slate-400">
                ใช้ {t.uses} ครั้ง · {t.category}
              </div>
              <Link
                href="/saved-viral"
                className="mt-2 inline-flex items-center gap-1 text-xs text-brand-600"
              >
                <Icon name="bookmark" className="h-3.5 w-3.5" /> บันทึก
              </Link>
            </div>
          ))}
        </div>
      </section>

      <StudioWorkspace
        studio="Viral Studio"
        placeholder="เลือกเทรนด์ด้านบน หรือพิมพ์หัวข้อ เช่น: ทำ Reel ท่องเที่ยวเชียงใหม่จากเทรนด์ที่กำลังฮิต"
        platforms={["TikTok", "Instagram", "YouTube"]}
      />
    </div>
  );
}

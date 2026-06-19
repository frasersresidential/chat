import { Icon } from "@/components/Icon";
import { viralNew, viralFeatured, type ViralCard } from "@/lib/mock-data";

export default function ViralStudioPage() {
  return (
    <div className="space-y-8">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
            <Icon name="flame" className="h-6 w-6 text-orange-500" /> Viral Studio
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            เลือกเทรนด์ที่สนใจ กรอกข้อมูลนิดเดียว แล้ว AI จะสร้างให้ครบชุด!
          </p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
            <Icon name="doc" className="h-3.5 w-3.5" /> ประวัติของฉัน
          </button>
          <button className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-slate-50 dark:border-slate-700">
            <Icon name="arrow" className="h-3.5 w-3.5" /> วิธีใช้งาน
          </button>
        </div>
      </div>

      {/* มาใหม่สัปดาห์นี้ */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
            <Icon name="sparkles" className="h-5 w-5 text-brand-500" /> มาใหม่สัปดาห์นี้
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700 dark:bg-brand-600/20">
              +3
            </span>
          </h2>
          <button className="flex items-center gap-1 text-xs text-brand-600">
            ดูทั้งหมด <Icon name="arrow" className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {viralNew.map((c) => (
            <ViralImageCard key={c.id} card={c} large />
          ))}
        </div>
      </section>

      {/* เทรนด์แนะนำ */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <Icon name="trophy" className="h-5 w-5 text-amber-500" /> เทรนด์แนะนำ
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {viralFeatured.map((c) => (
            <ViralImageCard key={c.id} card={c} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ViralImageCard({ card, large }: { card: ViralCard; large?: boolean }) {
  return (
    <article className="group overflow-hidden rounded-xl border border-slate-200 bg-white transition-shadow hover:shadow-lg dark:border-slate-800 dark:bg-slate-900">
      <div
        className={`relative flex ${
          large ? "aspect-[4/3]" : "aspect-square"
        } items-end bg-gradient-to-br ${card.gradient}`}
      >
        {/* badges */}
        <div className="absolute left-2 top-2 flex gap-1.5">
          {card.badge && (
            <span className="rounded-full bg-brand-600/90 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur">
              ✦ {card.badge}
            </span>
          )}
        </div>
        {card.tag === "HOT" && (
          <span className="absolute right-2 top-2 rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white">
            HOT
          </span>
        )}
        {card.tag === "ภาพไวรัล" && (
          <span className="absolute bottom-2 left-2 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
            ✦ ภาพไวรัล
          </span>
        )}
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold leading-snug text-slate-900 dark:text-white">
          {card.title}
        </h3>
        <div className="mt-1.5 flex items-center gap-1 text-xs text-slate-400">
          <Icon name="flame" className="h-3.5 w-3.5 text-orange-400" /> {card.meta}
        </div>
      </div>
    </article>
  );
}

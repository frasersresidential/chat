import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";
import { packages } from "@/lib/mock-data";

export default function PricingPage() {
  return (
    <div>
      <PageHeader
        icon="tag"
        title="ราคาแพ็กเกจ"
        description="เลือกแพ็กเกจที่เหมาะกับการสร้างคอนเทนต์ของคุณ"
      />
      <div className="grid gap-5 md:grid-cols-3">
        {packages.map((p) => (
          <div
            key={p.id}
            className={`flex flex-col rounded-2xl border bg-white p-6 dark:bg-slate-900 ${
              p.highlight
                ? "border-brand-500 ring-2 ring-brand-200 dark:ring-brand-600/30"
                : "border-slate-200 dark:border-slate-800"
            }`}
          >
            {p.highlight && (
              <span className="mb-3 w-fit rounded-full bg-brand-600 px-3 py-1 text-[11px] font-bold text-white">
                แนะนำ
              </span>
            )}
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{p.name}</h3>
            <div className="mt-2 flex items-end gap-1">
              <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
                {p.price === 0 ? "ฟรี" : `฿${p.price.toLocaleString()}`}
              </span>
              {p.price > 0 && <span className="mb-1 text-sm text-slate-400">/เดือน</span>}
            </div>
            <div className="mt-1 text-sm text-brand-600">
              {p.credits.toLocaleString()} เครดิต/เดือน
            </div>

            <ul className="mt-5 flex-1 space-y-2.5">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <Icon name="sparkles" className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                  {f}
                </li>
              ))}
            </ul>

            <button
              className={`mt-6 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                p.highlight
                  ? "bg-brand-600 text-white hover:bg-brand-700"
                  : "border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              }`}
            >
              {p.price === 0 ? "ใช้งานฟรี" : "อัพเกรด"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

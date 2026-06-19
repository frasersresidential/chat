import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";
import { creditHistory, currentUser } from "@/lib/mock-data";

export default function CreditsPage() {
  return (
    <div>
      <PageHeader icon="coin" title="เครดิตของฉัน" description="ยอดคงเหลือ · ประวัติการใช้งาน" />

      {/* ยอดคงเหลือ */}
      <div className="mb-6 flex items-center justify-between rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-6 dark:border-brand-600/30 dark:from-brand-600/10 dark:to-slate-900">
        <div>
          <div className="text-sm text-slate-500 dark:text-slate-400">เครดิตคงเหลือ</div>
          <div className="mt-1 text-4xl font-extrabold text-brand-700 dark:text-brand-300">
            {currentUser.credits}
          </div>
        </div>
        <button className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
          เติมเครดิต
        </button>
      </div>

      {/* ประวัติ */}
      <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">ประวัติการใช้งาน</h2>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {creditHistory.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0 dark:border-slate-800"
          >
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                c.amount > 0
                  ? "bg-emerald-50 text-emerald-500 dark:bg-emerald-500/10"
                  : "bg-slate-100 text-slate-400 dark:bg-slate-800"
              }`}
            >
              <Icon name={c.amount > 0 ? "plus" : "coin"} className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-slate-800 dark:text-slate-100">{c.action}</div>
              <div className="text-xs text-slate-400">
                {c.studio} · {c.date}
              </div>
            </div>
            <span
              className={`text-sm font-semibold ${
                c.amount > 0 ? "text-emerald-600" : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {c.amount > 0 ? `+${c.amount}` : c.amount}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

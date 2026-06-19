import Link from "next/link";
import { Icon } from "@/components/Icon";
import { WorkCard } from "@/components/WorkCard";
import {
  recentWorks,
  trends,
  featuredWorks,
  heroOfTheWeek,
  currentUser,
} from "@/lib/mock-data";

const quickActions = [
  { label: "ให้ AI ช่วยคิดไอเดีย", href: "/content-studio", icon: "bulb" },
  { label: "ลอง Viral Studio", href: "/viral-studio", icon: "flame" },
  { label: "ตั้ง Brand Voice", href: "/brand-voice", icon: "mic" },
];

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      {/* ทักทาย */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          สวัสดี {currentUser.name} 👋
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          วันนี้อยากสร้างคอนเทนต์อะไรดี?
        </p>
      </div>

      {/* Quick actions */}
      <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {quickActions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex items-center gap-3 px-5 py-3.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/50"
          >
            <Icon name={a.icon} className="h-5 w-5 text-brand-500" />
            <span className="flex-1 font-medium">{a.label}</span>
            <Icon name="arrow" className="h-4 w-4 text-slate-300" />
          </Link>
        ))}
      </div>

      {/* ผลงานล่าสุด + เทรนด์มาแรง */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* ผลงานล่าสุด */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
              <Icon name="doc" className="h-5 w-5 text-slate-400" /> ผลงานล่าสุด
            </h2>
            <Link href="/works" className="flex items-center gap-1 text-xs text-brand-600">
              ดูทั้งหมด <Icon name="arrow" className="h-3.5 w-3.5" />
            </Link>
          </div>
          <ul className="space-y-1">
            {recentWorks.map((w) => (
              <li
                key={w.id}
                className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <Icon name="doc" className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="flex-1 truncate text-sm text-slate-700 dark:text-slate-200">
                  {w.title}
                </span>
                <span className="shrink-0 text-xs text-slate-400">{w.createdAgo}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* เทรนด์มาแรง */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
              <Icon name="flame" className="h-5 w-5 text-orange-500" /> เทรนด์มาแรง
            </h2>
            <Link href="/viral-studio" className="flex items-center gap-1 text-xs text-brand-600">
              ดูทั้งหมด <Icon name="arrow" className="h-3.5 w-3.5" />
            </Link>
          </div>
          <ul className="space-y-1">
            {trends.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <Icon name="music" className="h-4 w-4 shrink-0 text-brand-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-700 dark:text-slate-200">
                    {t.title}
                  </span>
                  <span className="text-xs text-slate-400">
                    ใช้ {t.uses} ครั้ง · {t.category}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Hero of the week */}
      <section className="overflow-hidden rounded-xl border border-amber-300/60 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/5">
        <div className="flex items-center gap-4 p-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-amber-200/60 text-amber-600 dark:bg-amber-500/10">
            <Icon name="trophy" className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded bg-amber-400/80 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                {heroOfTheWeek.badge}
              </span>
              <span className="text-[10px] font-semibold text-amber-600">{heroOfTheWeek.tag}</span>
            </div>
            <p className="line-clamp-2 text-sm font-medium text-slate-800 dark:text-amber-100">
              {heroOfTheWeek.title}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-amber-200/70">
              โดย {heroOfTheWeek.author} · {heroOfTheWeek.brand}
            </p>
          </div>
        </div>
      </section>

      {/* ผลงานเด่นวันนี้ */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <Icon name="sparkles" className="h-5 w-5 text-brand-500" /> ผลงานเด่นวันนี้
          </h2>
          <Link href="/works" className="flex items-center gap-1 text-xs text-brand-600">
            ดูทั้งหมด <Icon name="arrow" className="h-3.5 w-3.5" />
          </Link>
        </div>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          ดูตัวอย่างจริงจาก Hero AI · กดที่ไพ่ไหนได้เพื่อดูวิธีสร้าง
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {featuredWorks.map((w) => (
            <WorkCard key={w.id} work={w} />
          ))}
        </div>
      </section>
    </div>
  );
}

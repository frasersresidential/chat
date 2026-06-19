import { currentUser } from "@/lib/mock-data";
import { Icon } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";

export function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
      {/* แบรนด์ปัจจุบัน */}
      <button className="flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
        <Icon name="palette" className="h-4 w-4 text-slate-400" />
        {currentUser.brand}
      </button>

      {/* โมเดล */}
      <button className="hidden items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 sm:flex dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
        <Icon name="sparkles" className="h-4 w-4 text-brand-500" />
        {currentUser.model}
      </button>

      <div className="ml-auto flex items-center gap-2">
        {/* streak */}
        <span className="hidden items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-600 sm:flex dark:bg-orange-500/10 dark:text-orange-400">
          <Icon name="flame" className="h-4 w-4" />
          {currentUser.streakDays} วันติด
        </span>

        {/* เครดิต */}
        <span className="flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-600/15 dark:text-brand-300">
          <Icon name="coin" className="h-4 w-4" />
          {currentUser.credits} เครดิต
        </span>

        <ThemeToggle />

        {/* ผู้ใช้ */}
        <div className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-slate-100 dark:hover:bg-slate-800">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
            {currentUser.name[0].toUpperCase()}
          </div>
          <div className="hidden leading-tight sm:block">
            <div className="text-xs font-medium text-slate-800 dark:text-slate-100">
              {currentUser.name}
            </div>
            <div className="text-[10px] text-slate-400">{currentUser.handle}</div>
          </div>
        </div>
      </div>
    </header>
  );
}

import type { Work } from "@/lib/mock-data";
import { Icon } from "./Icon";

const studioIcon: Record<string, string> = {
  "Content Studio": "sparkles",
  "Viral Studio": "flame",
  "Visual Studio": "image",
  "Style Cloner": "palette",
};

export function WorkCard({ work }: { work: Work }) {
  return (
    <article className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-center gap-2">
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-lg ${
            work.hot
              ? "bg-orange-50 text-orange-500 dark:bg-orange-500/10"
              : "bg-brand-50 text-brand-500 dark:bg-brand-600/15"
          }`}
        >
          <Icon name={work.hot ? "flame" : studioIcon[work.studio] ?? "sparkles"} className="h-4 w-4" />
        </span>
      </div>

      <h3 className="mb-1 line-clamp-2 text-sm font-semibold leading-snug text-slate-900 dark:text-white">
        {work.title}
      </h3>
      <p className="mb-3 line-clamp-3 flex-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {work.excerpt}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {work.studio}
        </span>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {work.platform}
        </span>
      </div>
    </article>
  );
}

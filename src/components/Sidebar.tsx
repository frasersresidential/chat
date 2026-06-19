"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navSections } from "@/lib/nav";
import { Icon } from "./Icon";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex dark:border-slate-800 dark:bg-slate-950">
      {/* โลโก้ */}
      <div className="flex items-center gap-3 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">
          H
        </div>
        <div className="leading-tight">
          <div className="font-semibold text-slate-900 dark:text-white">Hero AI</div>
          <div className="text-xs text-slate-400">Content Engine</div>
        </div>
      </div>

      {/* เมนู */}
      <nav className="flex-1 overflow-y-auto px-3 pb-6">
        {navSections.map((section, i) => (
          <div key={i} className="mt-4 first:mt-1">
            {section.title && (
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {section.title}
              </div>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`group flex items-start gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                        active
                          ? "bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-300"
                          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <Icon
                        name={item.icon}
                        className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${
                          active ? "text-brand-600 dark:text-brand-300" : "text-slate-400"
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium leading-tight">{item.label}</span>
                        {item.desc && (
                          <span className="block truncate text-[11px] text-slate-400">
                            {item.desc}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

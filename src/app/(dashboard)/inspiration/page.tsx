"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { inspirationItems, inspirationTabs, type InspoItem } from "@/lib/mock-data";

export default function InspirationPage() {
  const [tab, setTab] = useState<(typeof inspirationTabs)[number]>("ทั้งหมด");
  const [q, setQ] = useState("");

  const filtered = inspirationItems.filter((it) => {
    const matchTab =
      tab === "ทั้งหมด" ||
      (tab === "Featured" ? it.heroBadge : it.type === tab);
    const matchQ = !q || it.title.toLowerCase().includes(q.toLowerCase());
    return matchTab && matchQ;
  });

  return (
    <div>
      {/* header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
            <Icon name="sparkles" className="h-6 w-6 text-brand-500" /> Inspiration
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            ผลงานจริง · เลือกที่ชอบ → กด “ใช้เลย” → กลับมาสร้างเป็นของตัวเอง
          </p>
        </div>
        <button className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-slate-50 dark:border-slate-700">
          <Icon name="arrow" className="h-3.5 w-3.5" /> วิธีใช้งาน
        </button>
      </div>

      {/* tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {inspirationTabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? "bg-brand-600 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* search */}
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
        <Icon name="search" className="h-4 w-4 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหาแรงบันดาลใจ…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
      </div>

      <p className="mb-4 text-sm text-slate-400">{filtered.length} ผลงาน</p>

      {/* masonry grid */}
      <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
        {filtered.map((it) => (
          <div key={it.id} className="mb-4 break-inside-avoid">
            {it.type === "ภาพ" ? <ImageCard item={it} /> : <ContentCard item={it} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function ContentCard({ item }: { item: InspoItem }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-600 dark:bg-brand-600/15">
          {item.studio}
        </span>
        {item.heroBadge && (
          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15">
            ★ Hero AI
          </span>
        )}
      </div>
      <h3 className="mb-1 text-sm font-semibold leading-snug text-slate-900 dark:text-white">
        {item.title}
      </h3>
      <p className="mb-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {item.excerpt}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {item.tags.map((t) => (
          <span
            key={t}
            className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          >
            {t}
          </span>
        ))}
      </div>
    </article>
  );
}

function ImageCard({ item }: { item: InspoItem }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="mb-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
        {item.title}
      </p>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[9px] font-bold text-brand-600">
            K
          </span>
          {item.author}
        </span>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {item.niche}
        </span>
      </div>
    </article>
  );
}

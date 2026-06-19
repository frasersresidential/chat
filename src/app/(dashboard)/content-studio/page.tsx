"use client";

import { useState } from "react";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Icon } from "@/components/Icon";
import { StudioWorkspace } from "@/components/StudioWorkspace";
import { contentTemplates, niches, contentPlatforms } from "@/lib/mock-data";

export default function ContentStudioPage() {
  const [topic, setTopic] = useState("");
  const [niche, setNiche] = useState("");
  const [platform, setPlatform] = useState("Facebook");
  const [showResult, setShowResult] = useState(false);
  const [tipOpen, setTipOpen] = useState(true);

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumb items={[{ label: "Dashboard", href: "/" }, { label: "Content Studio" }]} />

      {/* เริ่มจากหัวข้อใหม่ */}
      <div className="mb-4 flex justify-center">
        <button className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <Icon name="sparkles" className="h-4 w-4 text-brand-500" /> เริ่มจากหัวข้อใหม่
        </button>
      </div>

      {/* tip banner */}
      {tipOpen && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <Icon name="bulb" className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            กด “Copy ทั้งหมด” หลัง gen เสร็จ · วาง Facebook ได้เลย
          </span>
          <button onClick={() => setTipOpen(false)} className="text-amber-400 hover:text-amber-600">
            ✕
          </button>
        </div>
      )}

      <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        {/* AI idea helper */}
        <button className="flex w-full items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-left text-sm text-brand-700 hover:bg-brand-100 dark:border-brand-600/30 dark:bg-brand-600/10 dark:text-brand-300">
          <Icon name="bulb" className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            ยังไม่รู้จะเขียนอะไร? พิมพ์หัวข้อหรือประเภทธุรกิจ แล้วให้ AI คิดไอเดียให้
          </span>
          <Icon name="arrow" className="h-4 w-4" />
        </button>

        {/* หัวข้อ / ไอเดีย */}
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
            หัวข้อ / ไอเดียที่อยากเล่า
          </label>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={4}
            placeholder='เช่น "AI ช่วย SME ไทยลดต้นทุน 70%" หรือ "5 เคล็ดลับโพสต์ FB ที่ไม่มีคน scroll ผ่าน"'
            className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-brand-600/20"
          />
          <div className="mt-1 text-right">
            <button className="text-xs font-medium text-brand-600">
              <Icon name="bulb" className="mr-1 inline h-3.5 w-3.5" /> ขอ AI ช่วยคิดไอเดีย
            </button>
            <p className="text-[11px] text-slate-400">
              พิมพ์หัวข้อหรือ niche สักหน่อย เพื่อให้ AI ต่อยอดให้
            </p>
          </div>
        </div>

        {/* เทมเพลต */}
        <div>
          <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
            <Icon name="sparkles" className="mr-1 inline h-4 w-4 text-brand-400" />
            หรือเริ่มจากเทมเพลตที่ตรงกับธุรกิจคุณ:
          </p>
          <div className="flex flex-wrap gap-2">
            {contentTemplates.map((t) => (
              <button
                key={t.id}
                onClick={() => setTopic(t.label)}
                className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                <Icon name={t.icon} className="h-3.5 w-3.5 text-brand-400" />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* niche */}
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
            ประเภทธุรกิจ / Niche <span className="font-normal text-slate-400">(ไม่บังคับ)</span>
          </label>
          <input
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="ระบุประเภทธุรกิจของคุณ เช่น เกษตร, ที่ปรึกษา, Personal Brand"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm outline-none focus:border-brand-400 dark:border-slate-700 dark:bg-slate-950"
          />
          <p className="mb-2 mt-2 text-xs text-slate-400">หรือเลือกจากประเภทยอดนิยม:</p>
          <div className="flex flex-wrap gap-2">
            {niches.map((n) => (
              <button
                key={n}
                onClick={() => setNiche(n)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  niche === n
                    ? "border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-600/15"
                    : "border-slate-200 text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:text-slate-300"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* แพลตฟอร์ม */}
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">
            แพลตฟอร์มที่จะใช้
          </label>
          <div className="flex flex-wrap gap-2">
            {contentPlatforms.map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                  platform === p
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-300"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                }`}
              >
                {platform === p && <Icon name="sparkles" className="h-3.5 w-3.5" />}
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Brand / Style */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Brand" icon="mic" value="ไม่ใช้ Brand Voice" />
          <Select label="Style" icon="palette" value="ไม่ใช้ Style" />
        </div>

        {/* tone note */}
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
          <Icon name="sparkles" className="h-4 w-4 text-amber-500" />
          โทนการเขียน: มาตรฐาน (ไม่ใช้แบรนด์/สไตล์) — เลือกได้จาก Brand/Style ด้านบน
        </div>

        <button
          onClick={() => setShowResult(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-3 text-sm font-bold text-white hover:bg-brand-700"
        >
          <Icon name="sparkles" className="h-4 w-4" /> เริ่มสร้าง Content
        </button>
      </div>

      {/* ผลลัพธ์ (ใช้ provider mock) */}
      {showResult && (
        <div className="mt-6">
          <StudioWorkspace
            studio="Content Studio"
            placeholder="ปรับโจทย์เพิ่มเติมได้ที่นี่"
            platforms={contentPlatforms}
          />
        </div>
      )}
    </div>
  );
}

function Select({ label, icon, value }: { label: string; icon: string; value: string }) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        <Icon name={icon} className="h-3.5 w-3.5" /> {label}:
      </label>
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
        {value}
        <Icon name="chevron" className="h-4 w-4 rotate-90 text-slate-400" />
      </div>
    </div>
  );
}

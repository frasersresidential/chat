"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";

const tones = ["เป็นกันเอง", "มืออาชีพ", "สนุก ขี้เล่น", "หรูหรา พรีเมียม", "ให้ความรู้", "กระตุ้นยอดขาย"];

export default function BrandVoicePage() {
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-white">
            <Icon name="palette" className="h-5 w-5 text-brand-500" /> Brand Voice
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            สร้างแบรนด์ของคุณแล้วใช้สไตล์นั้นในการสร้าง content ทุกครั้ง
          </p>
        </div>
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <Icon name="plus" className="h-4 w-4" /> สร้าง Brand ใหม่
        </button>
      </div>

      {creating ? (
        <div className="max-w-2xl space-y-5 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <Field label="ชื่อแบรนด์">
            <input
              placeholder="เช่น Aroi Cafe"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm outline-none focus:border-brand-400 dark:border-slate-700 dark:bg-slate-950"
            />
          </Field>
          <Field label="คำอธิบายแบรนด์">
            <textarea
              rows={3}
              placeholder="แบรนด์ขายอะไร กลุ่มลูกค้าเป็นใคร จุดเด่นคืออะไร"
              className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm outline-none focus:border-brand-400 dark:border-slate-700 dark:bg-slate-950"
            />
          </Field>
          <Field label="โทนเสียง">
            <div className="flex flex-wrap gap-2">
              {tones.map((t) => (
                <button
                  key={t}
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:text-slate-300"
                >
                  {t}
                </button>
              ))}
            </div>
          </Field>
          <div className="flex gap-2">
            <button className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
              บันทึก Brand Voice
            </button>
            <button
              onClick={() => setCreating(false)}
              className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400 dark:border-slate-700">
          ยังไม่มี Brand — เริ่มสร้าง Brand แรกของคุณเลย
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </label>
      {children}
    </div>
  );
}

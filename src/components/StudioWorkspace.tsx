"use client";

import { useState } from "react";
import { getProvider } from "@/lib/ai/provider";
import { Icon } from "./Icon";

type Props = {
  studio: string;
  placeholder: string;
  platforms?: string[];
  /** ปุ่มไอเดียเร็ว ๆ ที่เติมลงช่องกรอกได้ */
  presets?: string[];
};

// พื้นที่ทำงานของ Studio: กรอกโจทย์ → กดสร้าง → แสดงผล (ตอนนี้ใช้ provider mock)
export function StudioWorkspace({ studio, placeholder, platforms, presets }: Props) {
  const [prompt, setPrompt] = useState("");
  const [platform, setPlatform] = useState(platforms?.[0] ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleGenerate() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setResult(null);
    const provider = getProvider();
    const res = await provider.generate({ studio, prompt, platform });
    setResult(res.text);
    setLoading(false);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* แผงกรอกโจทย์ */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        {platforms && (
          <div className="mb-3 flex flex-wrap gap-2">
            {platforms.map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  platform === p
                    ? "bg-brand-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={placeholder}
          rows={6}
          className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-brand-600/20"
        />

        {presets && (
          <div className="mt-3 flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p}
                onClick={() => setPrompt(p)}
                className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1 text-xs text-slate-500 hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:text-slate-400"
              >
                {p}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={loading || !prompt.trim()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="sparkles" className="h-4 w-4" />
          {loading ? "กำลังสร้าง…" : "สร้างคอนเทนต์"}
        </button>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          * เวอร์ชันนี้ยังไม่ต่อ AI จริง — แสดงผลลัพธ์ตัวอย่าง
        </p>
      </div>

      {/* แผงผลลัพธ์ */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
          ผลลัพธ์
        </div>
        {loading ? (
          <div className="space-y-2">
            <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
            <div className="h-3 w-full animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          </div>
        ) : result ? (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700 dark:text-slate-200">
            {result}
          </pre>
        ) : (
          <div className="flex h-40 flex-col items-center justify-center text-center text-sm text-slate-400">
            <Icon name="sparkles" className="mb-2 h-6 w-6" />
            กรอกโจทย์แล้วกด “สร้างคอนเทนต์”
          </div>
        )}
      </div>
    </div>
  );
}

import { PageHeader } from "@/components/PageHeader";

const tones = ["เป็นกันเอง", "มืออาชีพ", "สนุก ขี้เล่น", "หรูหรา พรีเมียม", "ให้ความรู้", "กระตุ้นยอดขาย"];

export default function BrandVoicePage() {
  return (
    <div>
      <PageHeader
        icon="mic"
        title="Brand Voice"
        description="ตั้งโทน/สไตล์แบรนด์ของคุณ ให้ทุก Studio สร้างคอนเทนต์ออกมาเป็นเสียงเดียวกัน"
      />

      <div className="max-w-2xl space-y-5 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <Field label="ชื่อแบรนด์">
          <input
            type="text"
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

        <Field label="คำที่ห้ามใช้ (ถ้ามี)">
          <input
            type="text"
            placeholder="เช่น ถูกที่สุด, การันตี"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm outline-none focus:border-brand-400 dark:border-slate-700 dark:bg-slate-950"
          />
        </Field>

        <button className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
          บันทึก Brand Voice
        </button>
      </div>
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

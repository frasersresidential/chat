import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";

export default function ReferralPage() {
  const link = "https://app.heroaiengine.com/invite/kittipong";
  return (
    <div>
      <PageHeader
        icon="gift"
        title="แจกเครดิต"
        description="ชวนเพื่อน รับเครดิตฟรีทั้งคู่ — เพื่อนสมัครได้ +50 คุณได้ +50"
      />

      <div className="max-w-xl space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
            ลิงก์ชวนเพื่อนของคุณ
          </label>
          <div className="flex gap-2">
            <input
              readOnly
              value={link}
              className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
            />
            <button className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
              <Icon name="bookmark" className="h-4 w-4" /> คัดลอก
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Stat label="เพื่อนที่ชวนสำเร็จ" value="3 คน" />
          <Stat label="เครดิตที่ได้รับ" value="150" />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-2xl font-extrabold text-brand-700 dark:text-brand-300">{value}</div>
      <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}

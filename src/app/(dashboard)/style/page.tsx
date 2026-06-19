import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";

const clonedStyles = [
  { id: "s1", name: "นักรีวิวอาหารสายฮา", source: "TikTok @foodie", uses: 12 },
  { id: "s2", name: "เพจอสังหาฯ พูดตรง", source: "Facebook Page", uses: 5 },
  { id: "s3", name: "สายมินิมอลขายของแต่งบ้าน", source: "Instagram @minimal", uses: 8 },
];

export default function StylePage() {
  return (
    <div>
      <PageHeader
        icon="palette"
        title="Style ของฉัน"
        description="Style ที่โคลนไว้ หยิบไปใช้ใน Studio ไหนก็ได้"
        action={
          <button className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            <Icon name="plus" className="h-4 w-4" /> โคลนสไตล์ใหม่
          </button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clonedStyles.map((s) => (
          <div
            key={s.id}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-500 dark:bg-brand-600/15">
              <Icon name="palette" className="h-5 w-5" />
            </div>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{s.name}</div>
            <div className="text-xs text-slate-400">ที่มา: {s.source}</div>
            <div className="mt-2 text-xs text-slate-400">ใช้ไปแล้ว {s.uses} ครั้ง</div>
          </div>
        ))}
      </div>
    </div>
  );
}

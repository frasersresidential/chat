import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";

const folders = [
  { id: "fd1", name: "แคมเปญสงกรานต์", count: 14, color: "bg-orange-100 text-orange-500" },
  { id: "fd2", name: "ลูกค้า: Aroi Cafe", count: 9, color: "bg-brand-100 text-brand-500" },
  { id: "fd3", name: "คอนเทนต์ให้ความรู้", count: 21, color: "bg-emerald-100 text-emerald-500" },
  { id: "fd4", name: "ไอเดียรอทำ", count: 6, color: "bg-violet-100 text-violet-500" },
];

export default function FoldersPage() {
  return (
    <div>
      <PageHeader
        icon="folder"
        title="โฟลเดอร์"
        description="จัดกลุ่มงานตามแคมเปญ · ลูกค้า · ธีม"
        action={
          <button className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            <Icon name="plus" className="h-4 w-4" /> โฟลเดอร์ใหม่
          </button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {folders.map((f) => (
          <button
            key={f.id}
            className="flex flex-col items-start rounded-xl border border-slate-200 bg-white p-4 text-left transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
          >
            <span className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${f.color} dark:bg-opacity-20`}>
              <Icon name="folder" className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{f.name}</span>
            <span className="text-xs text-slate-400">{f.count} ชิ้น</span>
          </button>
        ))}
      </div>
    </div>
  );
}

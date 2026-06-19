import { PageHeader } from "@/components/PageHeader";
import { WorkCard } from "@/components/WorkCard";
import { featuredWorks, recentWorks } from "@/lib/mock-data";

export default function WorksPage() {
  const all = [...recentWorks, ...featuredWorks];
  return (
    <div>
      <PageHeader
        icon="doc"
        title="ผลงานของฉัน"
        description={`ทั้งหมด ${all.length} ชิ้น`}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {all.map((w) => (
          <WorkCard key={w.id} work={w} />
        ))}
      </div>
    </div>
  );
}

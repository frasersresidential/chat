import { PageHeader } from "@/components/PageHeader";
import { WorkCard } from "@/components/WorkCard";
import { featuredWorks } from "@/lib/mock-data";

export default function InspirationPage() {
  return (
    <div>
      <PageHeader
        icon="bulb"
        title="Inspiration"
        description="แรงบันดาลใจจากผลงานจริง · ไอเดียที่หยิบไปใช้ต่อได้ทันที"
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {featuredWorks.map((w) => (
          <WorkCard key={w.id} work={w} />
        ))}
      </div>
    </div>
  );
}

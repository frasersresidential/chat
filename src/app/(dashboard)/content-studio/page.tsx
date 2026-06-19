import { PageHeader } from "@/components/PageHeader";
import { StudioWorkspace } from "@/components/StudioWorkspace";

export default function ContentStudioPage() {
  return (
    <div>
      <PageHeader
        icon="sparkles"
        title="Content Studio"
        description="คิดไอเดีย · hook · สคริปต์ · แคปชั่น — ครบในที่เดียว"
      />
      <StudioWorkspace
        studio="Content Studio"
        placeholder="เช่น: เขียนแคปชั่น Facebook โปรโมทร้านคาเฟ่เปิดใหม่ย่านอารีย์ โทนเป็นกันเอง"
        platforms={["Facebook", "Instagram", "TikTok", "X", "YouTube"]}
        presets={[
          "10 ไอเดียคอนเทนต์ร้านเสื้อผ้าออนไลน์",
          "3 hook เปิดคลิป TikTok ร้านอาหาร",
          "แคปชั่นรีวิวสินค้า สไตล์ influencer",
        ]}
      />
    </div>
  );
}

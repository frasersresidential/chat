// โครงสร้างเมนู sidebar — ใช้ร่วมกันทั้ง Sidebar และ routing
// แก้ที่นี่ที่เดียว แล้วเมนูทั้งระบบจะอัปเดตตาม

export type NavItem = {
  label: string;
  href: string;
  desc?: string;
  icon: string; // ชื่อ icon (ดู components/Icon.tsx)
};

export type NavSection = {
  title?: string;
  items: NavItem[];
};

export const navSections: NavSection[] = [
  {
    items: [{ label: "Dashboard", href: "/", icon: "grid", desc: "ภาพรวมทั้งหมด" }],
  },
  {
    title: "สร้าง CONTENT · WORKFLOW",
    items: [
      {
        label: "Viral Studio",
        href: "/viral-studio",
        icon: "flame",
        desc: "หาเทรนด์ดัง · มาแรง ทำคอนเทนต์",
      },
      {
        label: "Content Studio",
        href: "/content-studio",
        icon: "sparkles",
        desc: "คิดไอเดีย · hook · สคริปต์ · ภาพ",
      },
      {
        label: "Visual Studio",
        href: "/visual-studio",
        icon: "image",
        desc: "สร้างภาพแบบเทพ — 72 เทมเพลต",
      },
      {
        label: "Inspiration",
        href: "/inspiration",
        icon: "bulb",
        desc: "แรงบันดาลใจจากผลงานจริง · ไอเดีย",
      },
    ],
  },
  {
    title: "แบรนด์ของคุณ",
    items: [
      {
        label: "Brand Voice",
        href: "/brand-voice",
        icon: "mic",
        desc: "ตั้งโทน/สไตล์แบรนด์ของคุณ",
      },
      {
        label: "Style ของฉัน",
        href: "/style",
        icon: "palette",
        desc: "Style ที่โคลนไว้ใช้ใน Studio",
      },
    ],
  },
  {
    title: "ของฉัน",
    items: [
      { label: "ผลงานของฉัน", href: "/works", icon: "doc", desc: "งานทั้งหมดที่สร้าง" },
      {
        label: "โฟลเดอร์",
        href: "/folders",
        icon: "folder",
        desc: "จัดกลุ่มงานตามแคมเปญ · ลูกค้า",
      },
      {
        label: "ปฏิทินคอนเทนต์",
        href: "/calendar",
        icon: "calendar",
        desc: "วางแผนโพสต์รายเดือน · ลากปล่อยวันได้",
      },
      { label: "Viral ที่บันทึก", href: "/saved-viral", icon: "bookmark", desc: "เทรนด์ที่เก็บไว้" },
    ],
  },
  {
    title: "เครดิต + แพ็กเกจ",
    items: [
      { label: "ราคาแพ็กเกจ", href: "/pricing", icon: "tag", desc: "เทียบแพ็กเกจ · อัพเกรด" },
      { label: "เครดิตของฉัน", href: "/credits", icon: "coin", desc: "ยอดคงเหลือ · ประวัติใช้งาน" },
      { label: "แจกเครดิต", href: "/referral", icon: "gift", desc: "ส่งลิงก์ชวนเพื่อน" },
    ],
  },
];

// flatten ไว้ใช้สะดวก เช่น หา title ของหน้าปัจจุบัน
export const allNavItems: NavItem[] = navSections.flatMap((s) => s.items);

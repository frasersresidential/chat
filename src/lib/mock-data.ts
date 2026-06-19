// ข้อมูลตัวอย่าง (mock) สำหรับวางโครงระบบ
// เมื่อต่อ backend/AI จริงแล้ว ให้แทนที่ฟังก์ชันเหล่านี้ด้วยการเรียก API

export type Platform = "Facebook" | "TikTok" | "Instagram" | "YouTube" | "X";
export type Studio = "Content Studio" | "Viral Studio" | "Visual Studio" | "Style Cloner";

export type Work = {
  id: string;
  title: string;
  excerpt: string;
  studio: Studio;
  platform: Platform;
  hot?: boolean;
  createdAgo: string;
};

export type Trend = {
  id: string;
  title: string;
  meta: string;
  uses: number;
  category: string;
};

export type CreditTxn = {
  id: string;
  action: string;
  studio: Studio;
  amount: number; // ติดลบ = ใช้, บวก = เติม
  date: string;
};

export type Pkg = {
  id: string;
  name: string;
  price: number; // บาท/เดือน
  credits: number;
  features: string[];
  highlight?: boolean;
};

export const currentUser = {
  name: "kittipong",
  handle: "คิดแสง",
  credits: 100,
  streakDays: 1,
  brand: "ไม่ตั้งแบรนด์",
  model: "Gemini 2.5 Flash · ระบบ",
};

export const recentWorks: Work[] = [
  {
    id: "w1",
    title: "วิธีเริ่มลงทุนกองทุนรวมสำหรับมือใหม่",
    excerpt: "สคริปต์คลิปสั้นสอนลงทุนแบบเข้าใจง่าย",
    studio: "Content Studio",
    platform: "TikTok",
    createdAgo: "4 วันที่แล้ว",
  },
  {
    id: "w2",
    title: "คอนโดใกล้ BTS เริ่ม 2 ล้าน",
    excerpt: "โพสต์ขายอสังหาฯ สไตล์ storytelling",
    studio: "Content Studio",
    platform: "Facebook",
    createdAgo: "4 วันที่แล้ว",
  },
];

export const trends: Trend[] = [
  { id: "t1", title: "สร้างเพลงแรป", meta: "Music", uses: 228, category: "Music" },
  {
    id: "t2",
    title: "สิ่งของปากจัด (RoastMaster Pro)",
    meta: "3D Animation",
    uses: 441,
    category: "3D Animation",
  },
  {
    id: "t3",
    title: "แก๊งวัยรุ่น 3D ซีเนโม่ ติดคนรว่า TikTok 500,000 บาท",
    meta: "3D Animation",
    uses: 201,
    category: "3D Animation",
  },
];

export const featuredWorks: Work[] = [
  {
    id: "f1",
    title: "โพสต์ Facebook ร้านคาเฟ่ที่ดึงคนมากขึ้น",
    excerpt:
      "ตัวอย่าง content โปรโมทร้านคาเฟ่บน Facebook ด้วยสไตล์ storytelling ที่ทำให้คนอยากมาลอง",
    studio: "Content Studio",
    platform: "Facebook",
    createdAgo: "วันนี้",
  },
  {
    id: "f2",
    title: "3 Hook TikTok สำหรับร้านอาหาร",
    excerpt: "ตัวอย่าง headline hook เปิด TikTok ที่ทำให้คนหยุดเลื่อน เหมาะสำหรับร้านอาหารและคาเฟ่",
    studio: "Content Studio",
    platform: "TikTok",
    createdAgo: "วันนี้",
  },
  {
    id: "f3",
    title: "หัวข้อโปรโมชั่นร้านคาเฟ่ที่กดแล้วต้องคลิก",
    excerpt: "ตัวอย่าง headline สำหรับโปรโมทร้านคาเฟ่ ใช้ framework AIDA + Curiosity Gap",
    studio: "Content Studio",
    platform: "Facebook",
    createdAgo: "วันนี้",
  },
  {
    id: "f4",
    title: "โคลนสไตล์นักรีวิวชื่อดัง",
    excerpt:
      "ตัวอย่างการใช้ Style Cloner วิเคราะห์สไตล์การเขียนรีวิวจาก influencer แล้วสร้าง content ตามสไตล์นั้น",
    studio: "Style Cloner",
    platform: "Instagram",
    createdAgo: "วันนี้",
  },
  {
    id: "f5",
    title: "รีวิวอาหาร Instagram สไตล์ Influencer",
    excerpt: "ตัวอย่าง caption IG สำหรับรีวิวอาหาร ด้วย tone ที่เป็นกันเอง อ่านง่าย ดึงดูดให้คนกด save",
    studio: "Content Studio",
    platform: "Instagram",
    createdAgo: "วันนี้",
  },
  {
    id: "f6",
    title: "10 ไอเดีย Content ร้านขายเสื้อผ้าออนไลน์",
    excerpt: "ใช้ brainstorm popover ใน Content Studio หาไอเดีย 10 อันสำหรับร้านเสื้อผ้าออนไลน์",
    studio: "Content Studio",
    platform: "Facebook",
    createdAgo: "วันนี้",
  },
  {
    id: "f7",
    title: "Reel ท่องเที่ยวจากเทรนด์ไวรัล",
    excerpt: "ตัวอย่างการใช้ Viral Studio สร้าง content ท่องเที่ยวจากเทรนด์ยอดฮิต ได้ script พร้อมถ่าย",
    studio: "Viral Studio",
    platform: "Instagram",
    hot: true,
    createdAgo: "วันนี้",
  },
  {
    id: "f8",
    title: "Vision AI + 3D Animation — โปรโมตสกินแคร์",
    excerpt:
      "อัปโหลดรูปสินค้าจริง ให้ AI วิเคราะห์แล้วสร้าง prompt สำหรับทำคลิป 3D สุดปังโปรโมตสกินแคร์",
    studio: "Viral Studio",
    platform: "TikTok",
    hot: true,
    createdAgo: "วันนี้",
  },
];

export const heroOfTheWeek = {
  badge: "HERO OF THE WEEK",
  tag: "VISUAL",
  title:
    "High-quality 3D render of a cute single-tier rainbow birthday cake. On top, a miniature 3D chibi character…",
  author: "ผู้ใช้คนหนึ่ง",
  brand: "Personal Brand",
};

export const creditHistory: CreditTxn[] = [
  { id: "c1", action: "สร้างโพสต์ Facebook", studio: "Content Studio", amount: -3, date: "วันนี้ 10:24" },
  { id: "c2", action: "สร้างภาพ 3D", studio: "Visual Studio", amount: -8, date: "วันนี้ 09:10" },
  { id: "c3", action: "หาเทรนด์ไวรัล", studio: "Viral Studio", amount: -2, date: "เมื่อวาน 18:30" },
  { id: "c4", action: "เติมเครดิตแพ็กเกจ Starter", studio: "Content Studio", amount: 100, date: "3 วันที่แล้ว" },
];

export const packages: Pkg[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    credits: 100,
    features: ["100 เครดิต/เดือน", "เข้าถึง Content Studio", "ลายน้ำบนภาพ", "ใช้ได้ 1 แบรนด์"],
  },
  {
    id: "starter",
    name: "Starter",
    price: 299,
    credits: 1000,
    highlight: true,
    features: [
      "1,000 เครดิต/เดือน",
      "ทุก Studio รวม Visual + Viral",
      "ไม่มีลายน้ำ",
      "ใช้ได้ 3 แบรนด์",
      "Brand Voice + Style Cloner",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 990,
    credits: 5000,
    features: [
      "5,000 เครดิต/เดือน",
      "ทุกฟีเจอร์ใน Starter",
      "ปฏิทินคอนเทนต์ + ทีมงาน",
      "แบรนด์ไม่จำกัด",
      "Priority queue",
    ],
  },
];

// เทมเพลตของ Visual Studio (ตัวอย่างบางส่วนจาก 72 เทมเพลต)
export const visualTemplates = [
  { id: "v1", name: "3D Chibi Character", category: "3D Animation" },
  { id: "v2", name: "Product Hero Shot", category: "E-commerce" },
  { id: "v3", name: "Food Flatlay", category: "อาหาร" },
  { id: "v4", name: "Real Estate Render", category: "อสังหาฯ" },
  { id: "v5", name: "Cinematic Portrait", category: "บุคคล" },
  { id: "v6", name: "Minimal Quote Card", category: "ข้อความ" },
  { id: "v7", name: "Neon Cyberpunk", category: "อาร์ต" },
  { id: "v8", name: "Pastel Birthday Cake", category: "อีเวนต์" },
];

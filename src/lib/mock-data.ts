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

// ---------- Content Studio ----------
export const contentTemplates = [
  { id: "ct1", label: "อธิบายแผนการเงิน", icon: "coin" },
  { id: "ct2", label: "เรื่องที่คนเข้าใจผิด", icon: "bulb" },
  { id: "ct3", label: "เปิดตัวสินค้าใหม่", icon: "sparkles" },
  { id: "ct4", label: "รีวิวแบบจริงใจ", icon: "trophy" },
  { id: "ct5", label: "Before-After", icon: "image" },
  { id: "ct6", label: "เคล็ดลับ 5 ข้อ", icon: "bulb" },
  { id: "ct7", label: "Promotion ลดราคา", icon: "flame" },
];

export const niches = [
  "ทั่วไป",
  "ขายของออนไลน์",
  "ร้านอาหาร",
  "อสังหาริมทรัพย์",
  "การเงิน-ลงทุน",
  "สุขภาพ-ความงาม",
  "การศึกษา-คอร์ส",
  "ฟรีแลนซ์-บริการ",
  "เกษตร-OTOP",
  "ช่าง-รับเหมา",
  "ท่องเที่ยว-โรงแรม",
  "Personal Brand",
];

export const contentPlatforms = ["Facebook", "Instagram", "TikTok", "YouTube", "TTS (เสียง)"];

// ---------- Viral Studio ----------
export type ViralCard = {
  id: string;
  title: string;
  meta: string;
  badge?: "NEW" | "HOT" | "Featured";
  tag?: string;
  gradient: string; // คลาส tailwind สำหรับพื้นหลังภาพ (placeholder)
};

export const viralNew: ViralCard[] = [
  {
    id: "vn1",
    title: "ตั๋ววิเศษเปิดโลก: ท่องเที่ยวสไตล์สมุดบันทึก",
    meta: "2 ครั้ง",
    badge: "NEW",
    tag: "ภาพไวรัล",
    gradient: "from-amber-200 via-orange-200 to-rose-200",
  },
  {
    id: "vn2",
    title: "จักรวรรดิแห่งจักรวาล (Celestial Ruler)",
    meta: "9 ครั้ง",
    badge: "NEW",
    tag: "ภาพไวรัล",
    gradient: "from-indigo-500 via-purple-600 to-slate-900",
  },
  {
    id: "vn3",
    title: "ซ้อนภาพตำนานลูกหนัง (Double Exposure Legend)",
    meta: "3 ครั้ง",
    badge: "NEW",
    tag: "ภาพไวรัล",
    gradient: "from-orange-300 via-amber-400 to-yellow-600",
  },
];

export const viralFeatured: ViralCard[] = [
  {
    id: "vf1",
    title: "สิ่งของปากจัด: กล้วยจอมกวน",
    meta: "441 ครั้ง · 3D Animation",
    badge: "Featured",
    tag: "HOT",
    gradient: "from-yellow-200 via-amber-200 to-lime-200",
  },
  {
    id: "vf2",
    title: "RoastMaster Pro: แก้วกาแฟหน้าบึ้ง",
    meta: "228 ครั้ง · 3D Animation",
    badge: "Featured",
    tag: "HOT",
    gradient: "from-stone-300 via-stone-400 to-stone-600",
  },
  {
    id: "vf3",
    title: "สมองปากจัด: คิดมากไปหมด",
    meta: "201 ครั้ง · 3D Animation",
    badge: "Featured",
    tag: "HOT",
    gradient: "from-rose-200 via-pink-300 to-red-300",
  },
];

// ---------- Inspiration ----------
export type InspoItem = {
  id: string;
  type: "คอนเทนต์" | "ภาพ" | "Viral" | "Featured";
  title: string;
  excerpt: string;
  studio?: Studio;
  author: string;
  niche: string;
  tags: string[];
  heroBadge?: boolean;
};

export const inspirationItems: InspoItem[] = [
  {
    id: "i1",
    type: "คอนเทนต์",
    title: "โพสต์ Facebook ร้านคาเฟ่ที่ดึงคนมากขึ้น",
    excerpt: "ตัวอย่าง content โปรโมทร้านคาเฟ่บน Facebook ด้วยสไตล์ storytelling ที่ทำให้คนอยากมาลอง",
    studio: "Content Studio",
    author: "Hero AI",
    niche: "ร้านอาหาร",
    tags: ["Facebook", "คาเฟ่", "Storytelling"],
    heroBadge: true,
  },
  {
    id: "i2",
    type: "คอนเทนต์",
    title: "โคลนสไตล์นักรีวิวชื่อดัง",
    excerpt: "ตัวอย่างการใช้ Style Cloner วิเคราะห์สไตล์การเขียนรีวิวจาก influencer แล้วสร้าง content ตามสไตล์นั้น",
    studio: "Style Cloner",
    author: "Hero AI",
    niche: "Personal Brand",
    tags: ["Instagram", "Review", "อาหาร"],
    heroBadge: true,
  },
  {
    id: "i3",
    type: "ภาพ",
    title: 'Story instagram แนวตั้ง มีข้อความไทยใหญ่ "สวัสดี อันดับ สุดสวย" + นักการตลาดออนไลน์',
    excerpt: "prompt ภาพแนวตั้งสำหรับ Story พร้อมข้อความไทย",
    author: "ผู้ใช้คนหนึ่ง",
    niche: "Personal Brand",
    tags: ["Image", "Story"],
  },
  {
    id: "i4",
    type: "ภาพ",
    title: "A split-screen style composition. Left side: A stressed young Thai female creator",
    excerpt: "prompt ภาพ split-screen ครีเอเตอร์ไทย",
    author: "ผู้ใช้คนหนึ่ง",
    niche: "ทั่วไป",
    tags: ["Image"],
  },
  {
    id: "i5",
    type: "คอนเทนต์",
    title: "รีวิวอาหาร Instagram สไตล์ Influencer",
    excerpt: "ตัวอย่าง caption IG สำหรับรีวิวอาหาร ด้วย tone ที่เป็นกันเอง อ่านง่าย ดึงดูดให้คนกด save",
    studio: "Content Studio",
    author: "Hero AI",
    niche: "ร้านอาหาร",
    tags: ["Instagram", "อาหาร", "Review"],
    heroBadge: true,
  },
  {
    id: "i6",
    type: "Viral",
    title: "Vision AI + 3D Animation — โปรโมตสกินแคร์",
    excerpt: "อัปโหลดรูปสินค้าจริง ให้ AI วิเคราะห์แล้วสร้าง prompt สำหรับทำคลิป 3D สุดปังโปรโมตสกินแคร์",
    studio: "Viral Studio",
    author: "Hero AI",
    niche: "สุขภาพ-ความงาม",
    tags: ["TikTok", "Instagram", "สุขภาพ"],
    heroBadge: true,
  },
  {
    id: "i7",
    type: "ภาพ",
    title: "High-quality 3D render of a cute single-tier rainbow birthday cake. On top, a miniature 3D chibi character",
    excerpt: "prompt ภาพเค้กวันเกิด 3D น่ารัก",
    author: "ผู้ใช้คนหนึ่ง",
    niche: "Personal Brand",
    tags: ["Image", "3D"],
  },
  {
    id: "i8",
    type: "คอนเทนต์",
    title: "3 Hook TikTok สำหรับร้านอาหาร",
    excerpt: "ตัวอย่าง headline hook เปิด TikTok ที่ทำให้คนหยุดเลื่อน เหมาะสำหรับร้านอาหารและคาเฟ่",
    studio: "Content Studio",
    author: "Hero AI",
    niche: "ร้านอาหาร",
    tags: ["TikTok", "อาหาร", "Hook"],
    heroBadge: true,
  },
  {
    id: "i9",
    type: "Viral",
    title: "Viral Studio Featured — Pixar Style สินค้า",
    excerpt: "ใช้เทรนด์ Featured ยอดนิยม 'สินค้าสไตล์ Pixar' สร้าง prompt ภาพไวรัลสำหรับโปรโมตสินค้า",
    studio: "Viral Studio",
    author: "Hero AI",
    niche: "ขายของออนไลน์",
    tags: ["Facebook", "Instagram", "ขายของออนไลน์"],
    heroBadge: true,
  },
  {
    id: "i10",
    type: "คอนเทนต์",
    title: "10 ไอเดีย Content ร้านขายเสื้อผ้าออนไลน์",
    excerpt: "ใช้ brainstorm popover ใน Content Studio หาไอเดีย 10 อันสำหรับร้านเสื้อผ้าออนไลน์ที่ขายบน Facebook + IG",
    studio: "Content Studio",
    author: "Hero AI",
    niche: "ขายของออนไลน์",
    tags: ["Facebook", "Instagram", "ขายของออนไลน์"],
    heroBadge: true,
  },
  {
    id: "i11",
    type: "ภาพ",
    title: "A dramatic close-up of a drain grate in a commercial kitchen floor, with murky, oily water slowly",
    excerpt: "prompt ภาพ cinematic ครัวร้านอาหาร",
    author: "ผู้ใช้คนหนึ่ง",
    niche: "ขายของออนไลน์",
    tags: ["Image"],
  },
  {
    id: "i12",
    type: "ภาพ",
    title: "A highly detailed 8K portrait poster inspired by the modern Grand Theft Auto VI promotional artwork",
    excerpt: "prompt ภาพโปสเตอร์สไตล์เกม",
    author: "ผู้ใช้คนหนึ่ง",
    niche: "ทั่วไป",
    tags: ["Image", "Poster"],
  },
];

export const inspirationTabs = ["ทั้งหมด", "Featured", "ภาพ", "คอนเทนต์", "Viral"] as const;

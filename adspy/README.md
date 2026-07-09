# 🕵️ Ad Spy — Facebook Competitor Ads Dashboard

แดชบอร์ดสอดแนมโฆษณาคู่แข่งบน Facebook — ดึงข้อมูลจาก **Meta Ad Library**
สาธารณะ (competitive intelligence ที่ถูกกฎหมาย ไม่ใช่การ scrape)

> Standalone app — แยกจาก OmniChat โดยสมบูรณ์: server, UI, storage,
> การ deploy เป็นของตัวเองทั้งหมด

## ✨ Features

| ฟีเจอร์ | รายละเอียด |
|---|---|
| **🎯 Watchlist** | เพิ่มเพจคู่แข่งเข้ามาเฝ้าดู เห็นจำนวนแอด active / ใหม่สัปดาห์นี้ / รันนานสุด ต่อราย |
| **📰 ฟีดโฆษณา** | headline, copy, CTA, แพลตฟอร์ม (FB/IG/Messenger/…) ของทุกแอด พร้อมค้นหา/เรียงลำดับ |
| **🖼️ ครีเอทีฟจริง** | กด "▶ ดูครีเอทีฟจริง" บนการ์ด → ฝังตัวเรนเดอร์โฆษณาทางการของ Meta (รูป/วิดีโอจริง) ผ่าน snapshot proxy ฝั่ง server — token ไม่หลุดไปหน้าเว็บ + ลิงก์ "🔍 Ad Library ↗" เปิดหน้าโฆษณาสาธารณะ |
| **🔥 แอดที่เวิร์ก** | เรียงตามระยะเวลาที่รัน — แอดที่คู่แข่งยอมจ่ายต่อเนื่องนาน มักแปลว่าทำกำไร |
| **★ คลังไอเดีย** | กดเก็บโฆษณาเด็ด ๆ ไว้เป็น swipe file พร้อมแท็ก |
| **🧠 วิเคราะห์** | คำ/hook ที่ใช้บ่อย, CTA, แพลตฟอร์ม, อายุโฆษณา, จังหวะปล่อยแอดต่อเดือน |
| **🔔 แจ้งเตือน** | Web Push เด้งเข้าเครื่องทันทีที่คู่แข่งปล่อยแอดใหม่ (แม้ปิดแท็บอยู่) — เช็คอัตโนมัติทุก 6 ชม. |

## 🚀 Quick start

```bash
cd adspy
npm install
npm start
# เปิด http://localhost:4000 → รหัสผ่าน spy1234
```

ไม่ต้องมี credential ใด ๆ — ไม่มี token = **โหมด MOCK** มีคู่แข่งตัวอย่าง
3 ราย (Sansiri / AP / LPN) ให้เล่นครบทุกฟีเจอร์ทันที

```bash
npm test     # unit tests
npm run dev  # auto-reload
```

## 🔌 ต่อข้อมูลจริง (Meta Ad Library)

1. สร้าง Meta access token ที่เรียก [Ad Library API](https://www.facebook.com/ads/library/api/) ได้
   (ต้องยืนยันตัวตนกับ Meta ก่อนสำหรับบางประเทศ/ประเภทแอด)
2. `cp .env.example .env` แล้วใส่ `META_AD_LIBRARY_TOKEN`
3. เพิ่มคู่แข่งด้วย **Page ID จริง** (หาได้จากหน้า About ของเพจ หรือใน Ad Library)

> ⚠️ **ข้อจำกัดของ Ad Library:** งบโฆษณาและ impressions เปิดเผยเฉพาะ
> แอดการเมือง/ประเด็นสังคมเท่านั้น — สำหรับแอดขายทั่วไปเครื่องมือนี้ให้
> *creative intelligence*: เห็นว่าคู่แข่งใช้แอดอะไร รันมานานแค่ไหน
> แต่ไม่รู้ว่าเขาใช้งบเท่าไหร่
>
> 🖼️ **รูป/วิดีโอจริง:** API ไม่ส่งไฟล์ media มาใน response — แอปนี้จึงแสดง
> ครีเอทีฟจริงผ่านตัวเรนเดอร์ทางการของ Meta (`render_ad`) แบบฝังในการ์ด
> โดย server เป็นคน redirect ให้ (URL ที่มี token ไม่ถูกเก็บลง DB และไม่ถูก
> ส่งให้ browser โดยตรง — ผู้ใช้ที่ล็อกอินแดชบอร์ดแล้วเท่านั้นที่เรียกได้)
> ในโหมด MOCK ปุ่มเดียวกันแสดง placeholder จำลองเพื่อให้ทดสอบ flow ได้

## ☁️ Deploy

**Docker:**
```bash
docker build -t adspy ./adspy
docker run -p 4000:4000 -e ADSPY_PASSWORD=your-secret adspy
```

**Render:** New → Web Service → เลือก repo นี้ → ตั้ง **Root Directory =
`adspy`** → Build `npm install` / Start `npm start` → ใส่ env vars ตาม
`.env.example`

## 🔑 API

ทุก endpoint (ยกเว้น `/api/login`) ต้องส่ง `Authorization: Bearer <token>`

```
POST /api/login                      {password} → {token}
GET  /api/config                     โหมด LIVE/MOCK + สถานะ push
GET  /api/competitors                watchlist พร้อมสถิติ
POST /api/competitors                {pageName, pageId?, country?}
PUT  /api/competitors/:id            แก้ชื่อ/เปิดปิดแจ้งเตือน
DELETE /api/competitors/:id
POST /api/competitors/:id/refresh    ดึงแอดล่าสุดของรายนี้
POST /api/refresh                    ดึงทุกราย
GET  /api/ads?competitorId&sort&q&saved
GET  /api/winning?limit
GET  /api/insights?competitorId
POST /api/ads/:id/save               {saved, tags?}
GET  /api/push/key · POST /api/push/subscribe
```

## 🏗️ Architecture

```
adspy/
  src/
    index.js     boot: push → seed → server → scheduler
    server.js    Express REST + password auth
    core.js      Ad Library adapter (LIVE/MOCK), win score, insights, scheduler
    push.js      Web Push broadcast (แจ้งเตือนแอดใหม่)
    store.js     zero-dependency JSON document store
    config.js    env → config
  public/        zero-build SPA (vanilla JS)
  test/          unit tests (node:test)
```

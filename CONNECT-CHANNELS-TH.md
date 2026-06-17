# เชื่อมต่อ LINE OA / Facebook ของจริง + Deploy ขึ้นเน็ต

แอปนี้รองรับการรับ-ส่งข้อความจริงทุกช่องทางอยู่แล้ว (มี webhook + signature verification + ส่งผ่าน API จริง) แต่แพลตฟอร์มจะยิงข้อความเข้ามาได้ ต้องมี **URL แบบ `https://` ที่เข้าถึงจากอินเทอร์เน็ต** ก่อน — รัน localhost บนเครื่องไม่พอ

ภาพรวม 3 ขั้น: **(1) Deploy → ได้ URL https → (2) สร้าง token จากแพลตฟอร์ม → (3) ใส่ token + ตั้ง webhook ในแอป**

---

## ขั้นที่ 1 — Deploy ขึ้น Render (ฟรี, มี HTTPS ให้)

1. สมัคร/ล็อกอิน https://render.com (ใช้ GitHub ล็อกอินได้)
2. กด **New → Blueprint** แล้วเลือก repo `frasersresidential/chat`
3. Render จะอ่านไฟล์ `render.yaml` ในโปรเจกต์เอง → กด **Apply**
4. รอ build เสร็จ จะได้ URL เช่น `https://omnichat-xxxx.onrender.com`
5. เปิด URL นั้น → ล็อกอินด้วย `u_owner@company-a.com` / `demo1234`
   (เปลี่ยนรหัสได้ที่ตัวแปร `DEMO_PASSWORD` ใน Render dashboard)

> 💡 ใช้ Railway / Fly.io / VPS ก็ได้ — มี `Dockerfile` ให้แล้ว (`docker build -t omnichat . && docker run -p 3000:3000 omnichat`)

ต่อจากนี้ `https://YOUR_APP` = URL ที่ Render ให้

---

## ขั้นที่ 2+3 — เชื่อม LINE Official Account

### สร้าง credential ใน LINE
1. เข้า https://developers.line.biz → สร้าง **Provider** → สร้าง channel แบบ **Messaging API**
2. เก็บค่า 2 ตัว:
   - **Channel secret** (แท็บ Basic settings)
   - **Channel access token (long-lived)** (แท็บ Messaging API → Issue)
3. ในแท็บ Messaging API:
   - **Webhook URL** = `https://YOUR_APP/webhooks/line`
   - เปิด **Use webhook** = ON
   - ปิด auto-reply/greeting ของ LINE (จะได้ไม่ชนกับระบบเรา)
4. หา **Bot user ID** (ขึ้นต้นด้วย `U...` ในแท็บ Messaging API) — ใช้เป็น `accountId`

### ใส่ในแอป OmniChat
1. ล็อกอินเป็น Owner/Admin → แท็บ **Channels**
2. ที่ LINE OA ที่ต้องการ กด **Edit** (หรือเพิ่มใหม่):
   - **External account id** = Bot user ID (`U....`)
   - **Channel Access Token** = ที่ได้จากข้อ 2
   - **Channel Secret** = ที่ได้จากข้อ 2
3. บันทึก → สถานะจะเป็น `● connected`
4. ทดสอบ: ส่งข้อความหา LINE OA จากมือถือ → ต้องเด้งเข้า Inbox

---

## ขั้นที่ 2+3 — เชื่อม Facebook Page (Messenger)

### สร้าง credential ใน Meta
1. เข้า https://developers.facebook.com → **Create App** → ประเภท **Business**
2. เพิ่ม product **Messenger**
3. **Generate token** ของเพจที่ต้องการ → ได้ **Page Access Token**
4. เก็บ **App Secret** (Settings → Basic)
5. ตั้ง **Webhooks**:
   - Callback URL = `https://YOUR_APP/webhooks/messenger`
   - **Verify Token** = ตั้งคำอะไรก็ได้ (เช่น `myverify123`) — ต้องตรงกับที่ใส่ในแอป
   - Subscribe ฟิลด์: `messages`, `messaging_postbacks`
6. หา **Page ID** ของเพจ — ใช้เป็น `accountId`

### ใส่ในแอป OmniChat
1. แท็บ **Channels** → Edit เพจที่ต้องการ:
   - **External account id** = Page ID
   - **Page Access Token** = จากข้อ 3
   - **App Secret** = จากข้อ 4
   - **Verify Token** = ค่าเดียวกับข้อ 5
2. บันทึก แล้วกลับไปกด **Verify** ฝั่ง Meta (Meta จะเรียก GET มาที่ webhook เพื่อตรวจ verify token)
3. ทดสอบ: ทักเพจจาก Messenger → ต้องเด้งเข้า Inbox

> Instagram / WhatsApp ใช้ผ่าน Meta เหมือนกัน — webhook คือ `/webhooks/instagram` และ `/webhooks/whatsapp`

---

## เช็กลิสต์เวลาต่อไม่ติด

| อาการ | ตรวจอะไร |
|---|---|
| Meta verify ไม่ผ่าน | Verify Token ในแอปต้องตรงกับใน Meta เป๊ะ และ URL เป็น https |
| ข้อความไม่เข้า | Webhook URL ถูกไหม, account id (Page ID / Bot userId) ตรงไหม |
| ส่งออกไม่ได้ | Access Token หมดอายุ/ผิด — ออก token ใหม่แล้ว Edit ใส่ใหม่ |
| LINE ตอบซ้ำ | ปิด auto-reply/greeting ในตั้งค่า LINE OA |

ติดตรงไหนส่ง error หรือสกรีนช็อตมาได้เลยครับ เดี๋ยวช่วยไล่ให้

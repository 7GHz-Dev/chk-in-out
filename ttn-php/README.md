# T TIME PHP

เวอร์ชันน้ำหนักเบาของ T TIME ใช้ HTML, CSS, Vanilla JavaScript และ PHP 8.5 บน Vercel โดยใช้บัญชีและข้อมูล Google Sheets/Drive ชุดเดียวกับระบบหลัก

## ความสามารถหลัก

- เข้างานและเลิกงานด้วยรูปภาพ ตำแหน่ง GPS และเวลาอ้างอิงประเทศไทย
- ประวัติพร้อม thumbnail แผนที่ Google ของจุดเข้างานและเลิกงาน โหลดเมื่อเลื่อนใกล้ถึงรายการ (แผนที่ฝังแบบไม่ต้องใช้ key และเปลี่ยนเป็นภาพนิ่ง Google Static Maps อัตโนมัติเมื่อตั้ง `GOOGLE_MAPS_API_KEY`)
- ผู้ดูแลระบบ (`admin`) และฝ่ายบุคคล (`hr`) ดูรายงานแบบ HR พร้อมกรองช่วงวันที่ ตำแหน่ง สถานะ และคำค้นได้
- ดาวน์โหลดรายงาน Excel `.xlsx` ที่จัดรูปแบบแล้ว มีชีต `Summary`, `Employee Summary` (วันทำงานและชั่วโมงรวมรายคน) และ `Attendance Details` พร้อมชั่วโมงทำงาน สถานะ URL แผนที่ และ URL หลักฐานรูปภาพ
- ผู้ดูแลระบบจัดการบัญชีผู้ใช้

รายงาน Excel สร้างด้วย Open XML ภายใน PHP โดยตรง ไม่ใช้ Composer ตัว endpoint `/api/report` ตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์และอนุญาตเฉพาะ `admin`/`hr` ข้อมูลสูงสุด 5,000 รายการต่อไฟล์

## Environment variables

- `GOOGLE_APPS_SCRIPT_URL` — URL ของ Apps Script web app
- `GOOGLE_APPS_SCRIPT_TOKEN` — token เดียวกับ Apps Script backend
- `SESSION_SECRET` — สุ่มอย่างน้อย 32 ตัวอักษร ห้ามใช้ร่วมกับ token อื่น
- `GOOGLE_MAPS_API_KEY` — (ไม่บังคับ) key ของ Google Static Maps สำหรับ thumbnail ตำแหน่ง

## Local development

ต้องมี PHP 8.1 ขึ้นไป แล้วรันจากโฟลเดอร์นี้:

```bash
php -S localhost:8000 router.php
```

Vercel ใช้ `vercel-php@0.9.0` และ PHP 8.5 การ deploy ควรตั้ง Root Directory เป็น `ttn-php`
PHP Function ถูกกำหนดให้รันที่ Singapore (`sin1`) เพื่อลด latency สำหรับผู้ใช้ในประเทศไทย

## ตรวจสอบก่อน deploy

```bash
node --check app.js
node --test tests/smoke.test.mjs
php -l api/index.php
php tests/xlsx-smoke.php
```

## การแชร์ผ่าน LINE

ใช้ลิงก์ `https://t-time-php.vercel.app/?openExternalBrowser=1` ในห้องแชต เพื่อให้ LINE เปิดแอปผ่าน Chrome หรือ Safari ซึ่งรองรับ GPS ได้เสถียรกว่า LINE in-app browser ตัวแอปตรวจจับ LINE และแสดงปุ่มเปิดภายนอกให้อัตโนมัติด้วย

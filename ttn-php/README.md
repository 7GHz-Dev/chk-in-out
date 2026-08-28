# T TIME PHP

เวอร์ชันน้ำหนักเบาของ T TIME ใช้ HTML, CSS, Vanilla JavaScript และ PHP 8.5 บน Vercel โดยใช้บัญชีและข้อมูล Google Sheets/Drive ชุดเดียวกับระบบหลัก

## Environment variables

- `GOOGLE_APPS_SCRIPT_URL` — URL ของ Apps Script web app
- `GOOGLE_APPS_SCRIPT_TOKEN` — token เดียวกับ Apps Script backend
- `SESSION_SECRET` — สุ่มอย่างน้อย 32 ตัวอักษร ห้ามใช้ร่วมกับ token อื่น

## Local development

ต้องมี PHP 8.1 ขึ้นไป แล้วรันจากโฟลเดอร์นี้:

```bash
php -S localhost:8000 router.php
```

Vercel ใช้ `vercel-php@0.9.0` และ PHP 8.5 การ deploy ควรตั้ง Root Directory เป็น `ttn-php`
PHP Function ถูกกำหนดให้รันที่ Singapore (`sin1`) เพื่อลด latency สำหรับผู้ใช้ในประเทศไทย

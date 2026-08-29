# T TIME

> เปิดจาก LINE และต้องใช้ GPS: แชร์ลิงก์ `https://chk-in-out.vercel.app/?openExternalBrowser=1` เพื่อเปิดผ่าน Chrome หรือ Safari โดยตรง

ระบบลงเวลาเข้างานและเลิกงานแบบ mobile-first พร้อมหลักฐานรูปภาพและตำแหน่ง GPS

## ความสามารถ

- ถ่ายรูปและบันทึกตำแหน่งตอนเข้างาน/เลิกงาน
- ดูประวัติพร้อมรูปและ thumbnail แผนที่ตำแหน่งโดยประมาณ
- Admin และ HR ดูประวัติของทุกคน
- Admin และ HR ดูรายงานแบบฝ่ายบุคคล กรองช่วงวันที่/บทบาท/สถานะ และดาวน์โหลด Excel `.xlsx` ที่มีชีตสรุปรายงาน สรุปรายบุคคล และรายละเอียดลงเวลา
- HR แก้ไขวันที่และเวลาเข้างาน–เลิกงานที่บันทึกผิดได้
- ตรวจตำแหน่งแบบหลายระดับเพื่อรองรับ Android/iOS และโทรศัพท์สเปกต่ำ
- Admin สร้างผู้ใช้และกำหนดบทบาท
- รองรับ `user`, `admin`, `hr`, `employee-driver` และ `employee-office`
- สร้าง Admin คนแรกผ่านหน้าเว็บเมื่อฐานข้อมูลยังว่าง

## การจัดเก็บข้อมูล

- ข้อมูลผู้ใช้และเวลา: [Google Sheet — Time In-Out](https://docs.google.com/spreadsheets/d/1SWSzPTDAmjcE8RPOLHT6oHeUVL1Lmpj7uvTFZDUU0kE/edit)
- รูปภาพ: [Google Drive — Time In-Out](https://drive.google.com/drive/folders/1N-gpcfG7mNp3KKWlWijiD81Ve_fVPK8a)
- API กลาง: Google Apps Script ในโฟลเดอร์ `apps-script/`

รหัสผ่านถูกเก็บเป็น PBKDF2-SHA256 hash พร้อม salt ไม่ได้เก็บรหัสผ่านแบบข้อความธรรมดา

## รันในเครื่อง

คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ URL ของ Apps Script, token สำหรับ API และ session secret จากนั้นรัน:

```bash
npm ci
npm run dev
```

เปิด `http://localhost:3000`

## ตรวจสอบก่อน deploy

```bash
npm run lint
npm test
npm run build
```

โปรเจกต์เป็น Next.js มาตรฐานและ deploy บน Vercel ได้โดยตรงจาก GitHub repository
[7GHz-Dev/chk-in-out](https://github.com/7GHz-Dev/chk-in-out.git)

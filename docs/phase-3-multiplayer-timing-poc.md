# Phase 3 Multiplayer Timing POC

สถานะ: Documentation / Repository Setup เท่านั้น

## Objective

พิสูจน์ว่า Mini Explorer สามารถจัดการ Multiplayer Question Timing ได้อย่างยุติธรรมสำหรับผู้เล่นหลาย Client ใน Room เดียวกัน โดยไม่มีผู้เล่นเห็นภาพก่อนหรือเสียเวลาไปกับการโหลดภาพ

เส้นทางขั้นต่ำที่ต้องพิสูจน์คือ:

`Room → Prepare Question → Preload → Decode → Client Ready → All Players Ready → Countdown → revealAt → Synchronized Reveal → Timer → Answer → Result`

## Scope

- ใช้ Classic Mode เป็นหลัก
- ทดสอบผู้เล่น 2–4 Client
- ใช้ Question เดียวหรือชุดคำถามขนาดเล็กที่เตรียมไว้แล้ว
- ใช้ Static Image ที่เตรียมไว้ล่วงหน้า
- Question Duration ทดลอง: 30 วินาที
- ใช้ Firebase Authentication
- ใช้ Firebase Realtime Database เป็นตัวเลือกแรกสำหรับทดลอง Runtime State เท่านั้น ยังไม่ใช่ Final Decision
- มี Diagnostic UI สำหรับดู Runtime State, Ready Status, `revealAt` และเวลาที่เหลือ
- ทดสอบ Blink Shared Clock เป็น timing scenario เพิ่มเติม แม้ Classic จะเป็นโหมดหลักของ POC

ค่าที่ระบุว่า “ทดลอง” ในเอกสารนี้เป็น POC Assumption ไม่ใช่กติกาเกมถาวร

## Out of Scope

- Question Factory เต็มระบบ
- Wikipedia API, Wikimedia API หรือ Gemini API
- Explore Mode ครบทุกแบบ
- Elimination และ Survival
- Production UI และ Production Deployment
- Profile, Stats, Achievement, Badge, Ranking, Social, Shop หรือ Battle Pass
- Public Matchmaking และระบบสำหรับผู้เล่นจำนวนมาก
- Cloudflare Workers, Durable Objects, D1, Pages Functions, R2, Supabase หรือ Backend อื่นที่ยังไม่มี Requirement
- การตัดสินใจแทน Project Owner ในรายการที่ยังเป็น TO BE DECIDED

## Runtime States

1. `LOBBY` — ผู้เล่นอยู่ใน Room และเห็นรายชื่อผู้เล่น
2. `PREPARING` — Client เตรียม Question, Preload และ Decode ภาพ
3. `CLIENT_READY` — Client แจ้งว่าภาพพร้อมสำหรับการเล่นจริง
4. `ALL_READY` — Active Client ทุกคนพร้อมแล้ว
5. `COUNTDOWN` — ระบบนับถอยหลังก่อนเปิด Question
6. `QUESTION` — ถึง `revealAt` แล้ว ภาพและ Choices เปิดพร้อมกัน
7. `ANSWER_LOCK` — หมดเวลา หรือรับคำตอบแล้ว และป้องกันการตอบซ้ำ
8. `RESULT` — แสดงผลการตอบและผลลัพธ์ของ Question

## Timing Protocol

1. Authority ส่งสัญญาณเริ่มเตรียม Question
2. Client ทุกเครื่องโหลดและ Decode ภาพ
3. Client แจ้ง Ready หลังจากภาพพร้อมจริง
4. Authority รอ Active Client ทุกคน Ready
5. Authority กำหนด `revealAt` เป็น Timestamp ในอนาคต
6. Client ได้รับ `revealAt` และยังซ่อนภาพไว้
7. เมื่อถึง `revealAt` ทุก Client เปิดภาพและ Choices
8. Timer อ้างอิง Timestamp เดียวกัน และเริ่มหลัง Ready Barrier
9. เมื่อหมดเวลาเข้าสู่ `ANSWER_LOCK` และ `RESULT`

สำหรับ Blink ให้คำนวณการแสดง/ซ่อนภาพจาก Shared Clock เดียวกัน:

`0–5s SHOW → 5–10s HIDE → 10–15s SHOW → 15–20s HIDE → 20–25s SHOW → 25–30s HIDE`

Choices ยังคงมองเห็นและตอบได้ในช่วงที่ภาพซ่อนอยู่

## Fairness Rules

- `Loaded ≠ Visible`
- Client ที่โหลดหรือ Decode เสร็จก่อนต้องไม่เห็นภาพก่อน Client อื่น
- Timer ต้องไม่เริ่มก่อน Active Client ทุกคน Ready
- ห้ามรับ Firebase Event แล้วแสดงภาพทันที
- ห้ามใช้ Local Independent Timer เป็นแหล่งเวลาหลัก
- การเปิดภาพและ Choices ต้องอ้างอิง `revealAt` เดียวกัน
- Client ต้องไม่ตัดสินผลเกมจากเวลาหรือคะแนนของตัวเองโดยลำพัง
- คำตอบซ้ำจาก Client เดิมต้องไม่ทำให้คะแนนหรือ Result ถูกนับซ้ำ
- Refresh/Temporary Disconnect ให้เก็บพฤติกรรมเพื่อการตัดสินใจภายหลังเท่านั้น ยังไม่กำหนด Reconnect Policy ถาวรใน POC

## Test Matrix

| Test | Scenario | Expected observation |
| --- | --- | --- |
| A | Normal Network | ทุก Client Ready และ Reveal ตาม protocol |
| B | Slow Client | ทุกคนรอ Client ที่ช้า และยังไม่เห็นภาพก่อน All Ready |
| C | Network Delay | Reveal อ้างอิง `revealAt` ไม่ใช่เวลาที่ Event มาถึง |
| D | Different Device Speed | Client ที่ Decode เร็วไม่เห็นภาพก่อน |
| E | Late Ready | ยังไม่เริ่ม Countdown จนกว่า Active Client จะ Ready |
| F | Blink Timing | Show/Hide ตรงกันตาม Shared Clock |
| G | Duplicate Answer | คำตอบซ้ำไม่เปลี่ยนคะแนนหรือ Result ซ้ำ |
| H | Refresh/Temporary Disconnect | บันทึก State และพฤติกรรมเพื่อใช้กำหนด policy ภายหลัง |

## Acceptance Criteria

- ทุก Client อยู่ใน Room เดียวกันและเห็น Runtime State เดียวกัน
- ทุก Client โหลดและ Decode ภาพก่อนเริ่ม Timer
- Client ที่พร้อมก่อนมองไม่เห็นภาพก่อน
- Timer ไม่เริ่มก่อน All Active Client Ready
- ทุก Client เปิดภาพใกล้เคียงกันตาม `revealAt`
- Blink เปลี่ยนสถานะตาม Shared Clock ไม่ใช่ Timer อิสระ
- Duplicate Answer ไม่ทำให้คะแนนหรือ Result ถูกนับซ้ำ
- Diagnostic data ระบุได้ว่าปัญหาเกิดจาก State, Network, Decode หรือ Timing

ผลสรุปของ POC ต้องจัดประเภทเป็น `PASS`, `PASS WITH LIMITATIONS` หรือ `FAIL`

## Diagnostic Data

Diagnostic UI/บันทึกการทดสอบควรแสดงอย่างน้อย:

- Room ID และ Client ID
- Current State
- Player Ready Status
- Image Preload Status
- Image Decode Status
- `revealAt`
- Current Shared Time
- Remaining Time
- Image Visibility
- Last State Event
- Timing Difference ระหว่าง Client
- ปัญหาและสาเหตุเบื้องต้น รวมถึงข้อจำกัดจาก Firebase หรือ Browser

## Stop Conditions

ให้หยุดการทดสอบและทบทวน protocol/model หากพบว่า:

- Client เห็นภาพก่อน All Ready
- Timer เริ่มก่อนภาพพร้อม
- Blink เปลี่ยนสถานะไม่ตรงกันระหว่าง Client
- Runtime State ซ้ำหรือขัดแย้งกันจนตรวจสอบไม่ได้

ห้ามขยาย Scope ด้วย Feature ใหม่เพื่อแก้ปัญหาเหล่านี้

## Next Step After POC

เมื่อ POC ผ่าน ให้:

1. สรุป Final Timing Protocol
2. ยืนยัน Firebase Data Layer ที่จะใช้ต่อ
3. เข้าสู่ Phase 4 — Content Pipeline POC
4. หลังจากนั้นจึงเริ่ม Core Game Implementation ตามลำดับที่ได้รับอนุมัติ

การเริ่มเขียน POC Code จริงต้องรอ Project Owner ตรวจสอบ Repository Setup และอนุมัติก่อน

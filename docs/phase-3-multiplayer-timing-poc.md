# Phase 3 Multiplayer Timing POC

สถานะ: Final verification complete — `PASS WITH LIMITATIONS` — Phase 3 freeze candidate

## Objective

พิสูจน์ว่า Mini Explorer สามารถจัดการ Multiplayer Question Timing ได้อย่างยุติธรรมสำหรับผู้เล่นหลาย Client ใน Room เดียวกัน โดยไม่มีผู้เล่นเห็นภาพก่อนหรือเสียเวลาไปกับการโหลดภาพ

เส้นทางขั้นต่ำที่ต้องพิสูจน์คือ:

`Room → Prepare Question → Preload → Decode → Client Ready → All Players Ready → Countdown → revealAt → Synchronized Reveal → Timer → Answer → Answer Lock → Result`

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

หลังจาก Project Owner อนุมัติ Phase 3 freeze candidate ให้:

1. สรุป Final Timing Protocol
2. ยืนยัน Firebase Data Layer ที่จะใช้ต่อ
3. เข้าสู่ Phase 4 — Content Pipeline POC เมื่อได้รับอนุมัติแยกต่างหาก
4. หลังจากนั้นจึงเริ่ม Core Game Implementation ตามลำดับที่ได้รับอนุมัติ

Phase 3 ไม่ใช่ Production Readiness approval และรายการที่ยังเป็น TBD ด้านล่างยังต้องได้รับการตัดสินใจแยกต่างหาก

## Phase 3 Final Verification Results

### Final classification

`PASS WITH LIMITATIONS`

Core multiplayer timing protocol ผ่าน automated และ live multi-client verification ครอบคลุม Ready Barrier, authority-controlled shared `revealAt`, shared timer, Blink shared clock, duplicate-answer idempotency, cross-device operation, browser network throttling และ refresh continuity ในขอบเขต POC อย่างไรก็ตาม ผลนี้ไม่ใช่การรับรอง production readiness เนื่องจาก reconnect policy, authority migration/disconnect behavior, production latency tolerance, scaling และรายการ TBD อื่นยังอยู่นอกขอบเขต

### A–H result matrix

| Test | Result | Verified evidence and limitation |
| --- | --- | --- |
| A — Normal Network | PASS | Anonymous Firebase clients สองรายมี UID ต่างกัน อยู่ใน Room เดียวกันและมี authority/client roles ถูกต้อง; preload, decode, Ready Barrier, hidden-before-reveal, shared `revealAt`, QUESTION, answers และ RESULT ทำงานครบ พบ reveal differences ตัวอย่าง `0 ms` และ `141 ms`; ยังไม่มี final production tolerance |
| B — Slow Client / Ready Barrier | PASS | เมื่อใช้ artificial delay `0 ms` และ `5000 ms`, fast Ready เวลา `11:27:39.971`, delayed Ready เวลา `11:27:44.912`, และ shared `revealAt` เวลา `11:27:48.082`; fast client ไม่เริ่มก่อน ระบบรอ delayed client ก่อน schedule reveal; การทดสอบ 3 clients ที่ `0/5000/7000 ms` รอ Ready รายสุดท้ายเช่นกัน |
| C — Network Delay | PASS WITH TEST LIMITATION | Firefox Regular 3G: Mobile Ready `12:34:49.372`, Firefox Ready `12:34:49.450`, expected reveal `12:34:52.691`, actual Firefox reveal `12:34:52.763`, difference `72 ms`; shared timing ยังเป็น authority แต่ browser throttling ไม่จำลองคุณลักษณะทั้งหมดของ degraded Firebase RTDB persistent connection |
| D — Different Device Speed / Cross Device | PASS WITH CROSS-DEVICE EVIDENCE | Linux desktop/Firefox และ mobile device เล่นผ่าน Firebase RTDB ใน Room เดียวกัน พบ preload/decode completion ต่างกันแต่ Ready Barrier ยัง synchronize ก่อน reveal; ทดสอบสำเร็จกับ 3 active clients ด้วย ข้อมูลนี้เป็น POC evidence ไม่ใช่ hardware benchmark |
| E — Late Ready | PASS | Hold Ready ทำให้ preload/decode เสร็จแต่ `readyAt`, `revealAt` และ Remaining Time ยัง unset; state อยู่ PREPARING และ image HIDDEN ราวสองนาที เมื่อ release: Ready `11:48:18.401`, reveal `11:48:21.674`, actual `11:48:21.727`, difference `53 ms`; flow เดินต่ออัตโนมัติโดยไม่ต้อง Prepare ซ้ำ |
| F — Blink Shared Clock | PASS | ช่วง HIDE แสดง `BLINK · image hidden by shared clock`; visibility มาจาก elapsed shared time ไม่ใช่ independent timer และ automated tests ครอบคลุม boundary ตลอดช่วง 0–30 วินาที |
| G — Duplicate Answer / Idempotency | PASS | หลังแก้เฉพาะ diagnostic harness โดยไม่เปลี่ยน protocol/rules, trace แสดง `CLICK RECEIVED → HANDLER ENTERED → DUPLICATE SUBMIT ATTEMPTED → FIREBASE TRANSACTION RESULT: committed=false → EXPECTED DUPLICATE REJECTION/NO-OP`; answer เดิมยัง authoritative และไม่มี answer/result contribution ซ้ำ |
| H — Refresh / Temporary Disconnect | PASS WITH OBSERVATION | Desktop และ mobile คง anonymous session และกลับ Room เดิมได้; refresh ระหว่าง QUESTION ไม่ reset shared timer, client ตอบได้หากยังมีเวลา และ client อื่นทำงานต่อ; ไม่ได้สรุป final reconnect policy และยังไม่มี authority migration |

### Validated timing protocol

`Prepare Question → Preload → Decode → Client Ready → Ready Barrier → shared revealAt → Countdown → synchronized visibility → shared timer → Answer → Answer Lock → Result`

หลักการที่ได้รับการยืนยันในขอบเขต POC:

1. `Loaded ≠ Visible` และการโหลดเร็วกว่าไม่ทำให้ได้ gameplay advantage
2. Client รายงาน Ready หลัง local preload และ decode ที่จำเป็นเสร็จแล้วเท่านั้น
3. Authority รอ required participants ก่อน schedule `revealAt`
4. Firebase ใช้กระจาย runtime state แต่การได้รับ event ไม่ได้เปิดภาพโดยตรง
5. Visibility และ Remaining Time คำนวณจาก `revealAt` และ shared/server-offset-adjusted time
6. Blink visibility ใช้ shared clock เดียวกัน
7. Duplicate answer ถูก transaction ปฏิเสธแบบ idempotent/no-op โดยไม่ overwrite answer เดิม
8. Refresh สามารถกู้ shared round timing ได้ในสถานการณ์ POC ที่สังเกต แต่ไม่กำหนด reconnect policy ถาวร

### Diagnostic harness finding

ระหว่าง Test G พบว่า control เดิมทำ transaction ได้ แต่ feedback อยู่ไกลจาก control ทำให้ดูเหมือนไม่ interactive การแก้ไขคง answer protocol, timing protocol และ Firebase Rules เดิมไว้ และเพิ่ม trace ใกล้ control เพื่อแสดง click, handler entry, transaction attempt และ `committed=false` อย่างตรวจสอบได้ Targeted clock updates ยังถูกเก็บไว้เพื่อป้องกัน ticker จากการแทนที่ interactive DOM ทุก 100 ms ส่วน trace จะถูกล้างเมื่อเข้าห้องหรือเริ่มรอบใหม่เพื่อไม่ให้หลักฐานต่างรอบปะปนกัน

### Known limitations and TBD

- Final production reveal tolerance
- Final player-count limit; ค่า 2–4 clients เป็น POC assumption
- Final question duration; ค่า 30 วินาทีเป็น POC assumption
- Final countdown duration; ค่า 3 วินาทีเป็น POC assumption
- Reconnect policy
- Authority migration
- Authority disconnect handling
- Production Firebase security architecture
- Final matchmaking architecture
- Final Firebase data-layer decision beyond the POC conclusion
- Large-scale concurrency behavior
- Production latency characteristics
- Speed-based scoring rules

ไม่มีรายการใดข้างต้นถูกตัดสินเป็น final game rule จากผล POC นี้

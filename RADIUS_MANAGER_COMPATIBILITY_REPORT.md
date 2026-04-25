# تقرير توافق Radius Manager (المرجع: ملفات SQL الأربعة)

**تاريخ:** 2026-04-26  
**مصدر الحقيقة لـ schema RADIUS/المشتركين/الفواتير/الإدارة:** الملفات التالية فقط (كما حددتَ):

- `.../sql/radius.sql`
- `.../sql/conntrack.sql`
- `.../sql/cumulate.sql`
- `.../sql/dbcleanup.sql`

**نطاق المشروع قيد المقارنة:** قاعدة `Future Radius` + `sql/schema_extensions.sql` (جداول إضافية حديثة لا تستبدل جداول DMA عند الاستعادة).

---

## 1. الجداول المكتشفة (من الملفات المرجعية)

### 1.1 `radius.sql` (قاعدة `radius`)

| الجدول | مفتاح / فهرس رئيسي | ملاحظة |
|--------|---------------------|--------|
| `nas` | PK `id` | عملاء RADIUS (DMA يضيف أعمدة API/CoA) |
| `radacct` | PK `radacctid` | accounting قياسي + أعمدة إضافية DMA (`_accttime`, `_srvid`, …) |
| `radcheck` | PK `id` | سمات التحقق (مثل `Cleartext-Password`) |
| `radgroupcheck` | PK `id` | |
| `radgroupreply` | PK `id` | |
| `radippool` | PK `id` | |
| `radpostauth` | PK `id` | |
| `radreply` | PK `id` | |
| `radusergroup` | (لا PK في الـ dump) | مفتاح منطقي: `username` + `groupname` + `priority` |
| `rm_actsrv` | UNIQUE `id` (غير مألوف) | تتبع تفعيل الخدمة |
| `rm_allowedmanagers` | | (`srvid`, `managername`) |
| `rm_allowednases` | | (`srvid`, `nasid`) |
| `rm_ap` | PK `id` | |
| `rm_cards` | PK `id` | |
| `rm_changesrv` | PK `id` | طلب تغيير باقة مجدول |
| `rm_cmts` | PK `id` | |
| `rm_colsetlistdocsis` / `rm_colsetlistradius` / `rm_colsetlistusers` | | تفضيلات أعمدة الواجهة لكل مدير |
| `rm_dailyacct` | | مزامنة يومية للـ accounting |
| `rm_ias` | PK `iasid` | Internet Access Services إضافية |
| `rm_invoices` | PK `id` | فواتير DMA (هيكل مختلف عن `invoices` الحديث) |
| `rm_ippools` | PK `id` | مسابح IP منطقية (ليست `radippool` السطرية) |
| `rm_managers` | PK `managername` | مدراء الويب + صلاحيات بت أعلام + `password` (MD5 نموذجي) |
| `rm_newusers` | PK `id` | تسجيل ذاتي |
| `rm_onlinecm` | PK `username` (MyISAM) | DOCSIS online |
| `rm_phpsess` | | جلسات PHP للمدراء |
| `rm_radacct` | (لا PK) | نسخة/أجزاء تفصيل لـ `radacct` (Bytes منفصلة) |
| `rm_services` | PK `srvid` | **تعريف الباقات/الخدمات** في DMA |
| `rm_settings` | (بدون مفتاح مفرد واضح في الـ dump) | إعدادات عامة (سطر/سطور) |
| `rm_specperacnt` / `rm_specperbw` | PK `id` | فترات/أولوية خاصة |
| `rm_syslog` | PK `id` | |
| `rm_usergroups` | PK `groupid` | |
| `rm_users` | PK `username` | **المشترك التشغيلي** (حدود، انتهاء، `srvid`, بيانات الاتصال) |
| `rm_wlan` | | لاسلكي (MyISAM) |

**ملاحظة مهمة:** جدول **`rm_payments` مذكور في طلبك كمرجع شائع لكنه غير موجود في `radius.sql` المقدَّم**؛ قد يكون لنسخة أخرى من Radius Manager أو قاعدة منفصلة. لا يجب الافتراض بوجوده دون `SHOW TABLES` على النسخة المستعادة.

### 1.2 `conntrack.sql` (قاعدة `conntrack`)

- جدول واحد: **`tabidx`**: `date` (DATE), PK(`date`) — **MyISAM**، يُستخدم لاتصال التتبع/الفهارس الزمني حسب بيئة قديمة (وليس بيانات مشتركين مباشرة).

### 1.3 `cumulate.sql` (سكربت تشغيلي، ليس CREATE SCHEMA كامل)

- يُكرّر بيانات سنة معيّنة في `radacct` و`rm_radacct`، ثم يحذف التفصيل ويستبدله بمُجمّع لكل `username` (لتخفيف الحمل).
- **دلالة:** `acctstarttime` / `acctstoptime` تُصبح `YYYY-12-31 23:59:59`، مع `SUM(acctsessiontime)` و`SUM(octets/bytes)`.

### 1.4 `dbcleanup.sql` (تنظيف + تعديل `rm_users`)

- حذف سنة من `radacct` و`rm_radacct` بعد تجميعها مؤقتاً.
- **يعدّل `rm_users`:** يطرح/يضيف من `uptimelimit`, `uplimit`, `downlimit`, `comblimit` عند الربط بـ `radacct1` / `rm_radacct1` — أي أن **بقايا الحدود في `rm_users` مرتبطة منطقياً ببيانات المحاسبة المحذوفة/المجمّعة** في النسخ القديمة.

---

## 2. المقارنة مع schema المشروع الحالي (`sql/schema_extensions.sql` + migrations)

| موضوع | Radius Manager (المرجع) | المشروع (Future Radius) | الحكم |
|--------|-------------------------|---------------------------|--------|
| المشترك | `rm_users` + `radcheck` + `radreply` + `radusergroup` | + جدول **`subscribers`** (UUID، `tenant_id`، `package_id` → `packages`) | **إضافي**؛ ليس بديلاً عن `rm_users` إن أُبقي التوافق. |
| الباقة | `rm_services` (`srvid`, …) | `packages` مع **`rm_srvid` اختياري** يربط الاثنين | **ربط** مسموح؛ الباقة التشغيلية لـ RADIUS تبقى من `rm_services` + RADIUS. |
| الفواتير | `rm_invoices` (DMA) | `invoices` / `payments` (حديث) | **مسماة مختلفة** — لا تُستبدل `rm_invoices` عند الاستعادة. |
| المدراء | `rm_managers` (مفتاح `managername`, MD5) | `staff_users` (bcrypt، JWT) | **نظامان**؛ التوافق = جسر/مزامنة أو تسجيل دخول مزدوج. |
| NAS | `nas` | `nas_servers` + `legacy_nas_id` | **طبقة إضافية** اختياريًا مع ربط `nas.id`. |
| الاستهلاك | `radacct` / `rm_radacct` + حدود في `rm_users` | `user_usage_*` (كاش) | **كاش اختياري**؛ الحقيقة يمكن أن تبقى من `radacct`. |

### 2.1 جداول مطابقة (أسماء/أعمدة مرجعية) في الكود

- العقد البرمجي `api/src/dma/dmaSchemaContract.ts` يعرّف **`DMA_REFERENCE_DUMP_TABLES`** و **`DMA_MINIMUM_COLUMNS`** لجداة فرعية: `radcheck`, `rm_users`, `radreply`, `radusergroup`, `radacct`, `nas`, `rm_services` — **مطابقة جزئية** لما في `radius.sql` (للتحقق البرمجي، ليس الاستعلام الكامل بكل الأعمدة).

### 2.2 جداول غير مطابقة (اسم اختلاف أو غير موجود في المرجع)

- **`rm_payments`**: مذكور في المتطلبات، **غير مُعرَّف في `radius.sql` المرفق**.
- جداول المشروع: `tenants`, `subscribers`, `packages`, `invoices` (الحديثة), `payments` (الحديثة), `nas_servers`, `staff_users`, `user_usage_*`, … — **إضافية** بخصائص أسماء/أعمدة مختلفة عن DMA.

### 2.3 أعمدة مفقودة/زائدة/أنواع

- **مفقود من منظور "المشروع فقط"**: أي عمود من `rm_users` (مثل `credits`, `owner`, `custattr`, …) **غير** مخزن في `subscribers` إلا إذا وُسّعَ الربط.
- **زائد في المشروع**: كل أعمدة `subscribers` و`packages` غير الموجودة في DMA (مثل `radius_password_encrypted`, `id` UUID).
- **فروقات أنواع**: المشروع يستخدم `CHAR(36)` + `InnoDB` + `utf8mb4` في الإضافات؛ المرجع `utf8` و MyISAM لبعض الجداول — **مقبول** عند الاستعادة لأن DMA يبقى كما في الملف.

### 2.4 اختلافات وظيفية (semantics)

- **انتهاء الاشتراك:** في DMA = `rm_users.expiration` (datetime). المشروع يحتفظ بـ`subscribers.expiration_date` كقناة واجهة؛ يجب **عدم** كسر الوجهة `rm_users.expiration` عند الكتابة.
- **كلمات مرور RADIUS:** `radcheck` (Cleartext-Password أو غيره) = مصدر RADIUS الحقيقي؛ `subscribers.radius_password_encrypted` أداة داخلية اختيارية.
- **كلمات مرور المدراء:** `rm_managers.password` = MD5 (32 hex) نموذجي؛ `staff_users.password_hash` = bcrypt.

---

## 3. خريطة ربط مقترحة (عالية المستوى)

| جدول المشروع | جدول/مصدر DMA | الربط |
|----------------|----------------|--------|
| `subscribers.username` | `rm_users.username` + `radcheck.username` | 1:1 عند الاسم |
| `subscribers` ↔ باقة | `rm_users.srvid` → `rm_services.srvid` | `packages.rm_srvid` |
| `packages` | `rm_services` | اختياري تعريف كتالوج حديث |
| `staff_users` | `rm_managers` | جسر/مزامنة تدريجية أو تسجيل دخول مزدوج |
| `nas_servers.legacy_nas_id` | `nas.id` | اختياري |
| `invoices` (حديث) | `rm_invoices` | **لا** استبدال مباشر لأسماء/أعمدة مختلفة |

---

## 4. نقاط عدم التوافق العملية (قبل/بعد التنفيذ)

1. **اسم قاعدة `DATABASE()`**: كان الربط يرفض أي اسم غير `radius` — **يُفضّل** السماح باسم عبر `RM_DATABASE_NAME` للاستعادات بأسماء مختلفة مع الاحتفاظ بمرجع `radius` كافتراضي.
2. **تسجيل دخول المدير:** كان يعتمد `staff_users` فقط — لا يطابق `rm_managers` بعد الاستعادة مباشرة.
3. **تسجيل دخول المشترك (بوابة):** يفترض صف `subscribers`؛ قاعدة DMA خام قد **لا** تحتوي صفاً بعد — يحتاج **مزامنة** من `importSubscribersFromDma` أو **مزامنة عند أول تسجيل ناجح** (لنفس `tenant`).
4. **التحقق البرمجي:** `validate:dma-schema` يتحقق من الجداول/الأعمدة الدنيا، لكن لا يقارن **عدد السجلات** ولا **عيّنات القيم** — **يُكمل** بسكربت `verify-rm-restore` (انظر خطة التنفيذ).

---

## 5. حالة "التوافق الكامل"

**لا يُعلَن بتوافق كامل** إلا بعد:

1. تشغيل `npm run verify:rm-restore` (أو مكافئ) على نسخة **مستعادة** ومراجعة تقرير **diff** بدون اختلافات في العتبات المحددة في السكربت.
2. اختبار يدوي: `import:dma` + تسجيل دخول مدير + مشترك + قراءة `radacct`.

---

*نهاية التقرير.*

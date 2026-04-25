# خطة التنفيذ: توافق Radius Manager + Future Radius

**مرجع schema:** نفس الملفات الأربع في `RADIUS_MANAGER_COMPATIBILITY_REPORT.md`.

---

## 1. Backend

| المهمة | الحالة / الإجراء |
|--------|-------------------|
| جعل التحقق من قاعدة DMA يتوقع اسم قاعدة قابل للضبط (`RM_DATABASE_NAME`) | يتطابق مع `DATABASE_URL` بعد التعديل |
| تخفيف شرط `DATABASE_URL` ليكون نفس **`RM_DATABASE_NAME`** (افتراضي `radius`) | يمنع رفض الاتصال عند استعادة باسم متوافق مع المتغير |
| جسر **تسجيل دخول المدراء** من `rm_managers` (MD5) إلى إنشاء/تحديث `staff_users` | يدخل المستخدم إلى الواجهة الحديثة مع الحفاظ على `rm_managers` كمرجع |
| استيراد المشتركين `importSubscribersFromDma` مع **`onlyUsernames`** | يدعم مزامنة مستخدم واحد عند تسجيل الدخول من الـ API |
| التحقق من كلمة مرور المشترك: `radcheck` + fallback MD5 `rm_users.password` | نفس سلوك DMA عند عدم وجود Cleartext في `radcheck` |
| بوابة المشترك: إن لم يوجد `subscribers` بعد، مزامنة من DMA ثم المتابعة | قاعدة مستعادة تعمل دون خطوة يدوية إلزامية |
| **سكربت** `verify-rm-restore` | مقارنة أعداد/عيّنات مع ما يقرأه التطبيق |

### ملفات معدّلة (مخطط)

- `api/src/config.ts` — `RM_DATABASE_NAME`، عدم رفض الاتصال باسم خاطئ إذا تطابق مع المتغير
- `api/src/dma/validateDmaDatabase.ts` — اسم متوقع من الإعداد
- `api/src/dma/dmaSchemaContract.ts` — توثيق `rm_payments` اختياري
- `api/src/dma/importSubscribersFromDma.ts` — `onlyUsernames`
- `api/src/routes/auth.routes.ts` — جسر `rm_managers`
- `api/src/services/rm-legacy-staff.service.ts` (جديد) — ربط MD5 + upsert `staff_users`
- `api/src/dma/legacyPassword.ts` (جديد) — تحقق من كلمة المرور
- `api/src/routes/subscriber-portal.routes.ts` — تسجيل دخول بدون `subscribers` + استدعاء الاستيراد الانتقائي

---

## 2. Frontend

- **لا تغييرات إلزامية** لنفس الـ API إذا بقي شكل الاستجابة (`/auth/login`, `/subscriber-portal/login`).
- إن رغبت بعرض "وضع DMA"، يمكن إضافة لاحقاً مؤشر أن الجلسة مربوطة بـ`rm_managers` (اختياري).

---

## 3. Migrations (SQL)

- **لا** تغيير على جداول `rad*`, `rm_*`, `nas` عند الاستعادة من `radius.sql`.
- الإضافات في `schema_extensions.sql` تبقى **بعد** تحميل `radius.sql` كما هو موثق في الملف.
- اختياري مستقبلاً: عمود `staff_users.rm_managername` للربط الصريح — **غير مطلوب** إذا الاعتماد على البريد/الاسم.

---

## 4. الاستيراد / الاستعادة

1. `mysql` لاستعادة `radius.sql` (قاعدة الاسم: `radius` أو الاسم المضبوط عبر `RM_DATABASE_NAME` و`DATABASE_URL`).
2. (اختياري) قاعدة `conntrack` من `conntrack.sql` إن كنت تستخدم تتبع الاتصالات القديم.
3. تطبيق `schema_extensions.sql` + migrations المشروع على **نفس** الخادم/القاعدة أو قاعدة مدمجة (حسب نشرك).
4. `npm run import:dma` أو الاستدعاء من الواجهة لملء `subscribers` من DMA.
5. `npm run verify:rm-restore` للتحقق.

**تحذير:** `cumulate.sql` و`dbcleanup.sql` ي**غیّران** بيانات `radacct` / `rm_radacct` / `rm_users` — نفّذ فقط بفهم كامل ونسخة احتياطية.

---

## 5. التحقق (Verification)

- السكربت `api/src/scripts/verify-rm-restore.ts` يطبع تقريراً JSON: أعداد `rm_users`, `radcheck`, `radacct`, `rm_managers`, `rm_services`, `subscribers`، و`subscribers_username_overlap_with_rm_users`.
- **متغيرات:** `RM_VERIFY_STRICT_SYNC=1` يضيف فشلاً إذا كان عدد صفوف `rm_users` (باستثناء أسماء فارغة) أكبر من عدد المشتركين المطابقين لنفس `username` (بعد `import:dma`).
- **`RM_DATABASE_NAME`:** إذا ضبطته، `validateDmaDatabase` يتطلب أن `SELECT DATABASE()` يساوي هذا الاسم؛ اتركه فارغاً لقبول أي اسم قاعدة عند الاستعادة.
- **معيار "نجاح" في السكربت:** `dma_validation.ok === true` وعدم وجود `diffs` (ما لم تُفعّل المزامنة الصارمة).

---

*نهاية الخطة.*

# ملف أدوات Hub Boss (استرجاع جزئي)

## المحتويات الحقيقية

- **13 أداة/مشروع** في `TOOLS_MANIFEST.json` و`TOOLS_TABLE.csv` مع الروابط الرسمية ونتائج الاختبار.
- **2 ملفات Plugin أصلية كاملة قابلة للتثبيت/الفحص دون إنترنت** تحت `original_plugins/`، وهما Lapian Notes Companion وFree Marketing SEO Audit.
- **3 Plugins خاصة إضافية محفوظة في حساب ChatGPT** لكنها غير مضمّنة داخل هذا الملف: nanoMuse Bridge، n8n Workflow Library، ECC 68 Agent Suite. تحت `PRIVATE_PLUGIN_LINKS.md` روابطها. لا نخلط بين رابط Plugin وبين ملفات ZIP الموجودة.
- **10 مستودعات عامة** يمكن استرجاع كودها باستخدام `scripts/fetch_public_sources.py`، منها الكود الأصلي لـnanoMuse/n8n/ECC. لا تحتاج إنشاء حساب أو دفع أموال، لكن تحتاج إنترنت وGit.
- **النموذجان الكبيران GLM-5.3-Flash وKimi K3** تم تضمين روابطهما فقط، وليس ملفات الأوزان الضخمة.
- تقرير آخر اختبار ضمن `reports/`.

## تحميل الأكواد المتاحة من المستودعات الرسمية

```bash
python3 scripts/fetch_public_sources.py --list
python3 scripts/fetch_public_sources.py --all
```

أو لتحميل مشروع واحد فقط:

```bash
python3 scripts/fetch_public_sources.py --only munder-difflin
```

**مهم:** سكربت الاسترجاع لا يشغّل Agent، ولا يستعمل GPU، ولا ينشئ حسابات، ولا يتطلب دفعًا. يحافظ على المجلدات الموجودة ولا يمسحها.

## التحقق من الملفات دون إنترنت

```bash
python3 scripts/verify_bundle.py
```

## حالة Hub Boss

هذه **حزمة ملفات أدوات**، وليست Hub Boss مفعّلًا. لا يوجد تكامل حقيقي مؤكد بين الأدوات وBoss. لم نجرب جميع التطبيقات end-to-end، ولا يوجد ما يثبت أن الملفات القديمة على السيرفر قد استعيدت كاملة.

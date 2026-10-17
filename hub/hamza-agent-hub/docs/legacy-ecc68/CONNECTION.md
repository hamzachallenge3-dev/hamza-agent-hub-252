# تعليمات الاتصال (مُتحققة)

## ما الذي يعمل فعلياً؟

| الطريقة | الحالة | عنوان الاتصال |
|---|---|---|
| Cursor MCP stdio | جاهز بعد `npm run build` | عملية محلية عبر `dist/index.js` — لا URL |
| Streamable HTTP على localhost | جاهز عند ضبط `ECC68_AUTH_TOKEN` | `http://127.0.0.1:8787/mcp` فقط بعد تشغيل السيرفر |
| HTTPS بعيد | غير مُعدّ في هذه البيئة | لا تُبلغ عن URL بعيد غير مُكوَّن |

ملف ZIP الأصلي **لا يربط** أي شيء بمفرده.

## التحقق السريع

```bash
cd ecc68-lab
npm install && npm run build
npm test
node --experimental-sqlite dist/index.js
# (stdio ينتظر stdin من عميل MCP — هذا متوقع)
```

للـ HTTP:

```bash
ECC68_TRANSPORT=http ECC68_AUTH_TOKEN=dev-token ./scripts/start.sh
curl -s -H "Authorization: Bearer ${ECC68_AUTH_TOKEN}" http://127.0.0.1:8787/healthz
```

## نموذج مجاني

بدون `ECC68_MODEL_URL`: التنفيذ الحي للنموذج = **BLOCKED**.  
المسار heuristic يكفي لاختبارات الطابور/الأدوات/التوجيه.

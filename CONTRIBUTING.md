# Contributing to আকাশ / Akash

Thank you for helping improve Akash! We especially welcome **Bangla (বাংলা) astronomical names** for stars, constellations, and deep-sky objects.

---

## Contributing Bangla Names (বাংলা নাম যোগ বা সংশোধন)

You can contribute Bangla names in two ways:

### Option 1: Open an Issue (No coding required / কোডিং ছাড়াই)
1. Go to **Issues → New Issue → Bangla Name Suggestion**.
2. Fill in:
   - **Category** (Constellation / Star / Planet)
   - **English Name** (e.g. `Orion`, `Sirius`)
   - **Proposed Bangla Name** (e.g. `কালপুরুষ`, `লুব্ধক`)
   - **Source / Reference** (book, nakshatra tradition, Wikipedia, etc.)
   - **Confidence** (High / Medium / Low)

### Option 2: Edit `data/names_bn.json` via Pull Request (PR)
1. Use the built-in **Names Editor (✏️)** inside the Akash web app to add/edit Bangla names and click **"Export for GitHub PR"**.
2. Or edit `data/names_bn.json` directly:
   ```json
   {
     "constellations": {
       "Orion": { "bn": "কালপুরুষ", "verified": true }
     },
     "stars": {
       "Sirius": { "bn": "লুব্ধক", "verified": false }
     }
   }
   ```
3. **Rules**:
   - Never invent a Bangla name — if unsure, omit it or cite your source.
   - `bn` must be a non-empty string containing Bengali script characters (`\u0980-\u09FF`).
   - Run the validator locally before opening a PR:
     ```bash
     node scripts/validate_names.js data/names_bn.json
     npm test
     ```

---

## বাংলায় নির্দেশিকা (Bangla Guide)

আকাশ (Akash) প্রকল্পে তারা ও নক্ষত্রমণ্ডলের বাংলা নাম যোগ করতে চাইলে:

১. **সহজ উপায় (Issue ফর্ম)**: GitHub-এ `Issues → New Issue → Bangla Name Suggestion` ফর্মটি পূরণ করুন। ইংরেজি নাম, বাংলা নাম, উৎস (বই, পঞ্জিকা বা ওয়েবসাইট) এবং আপনার আস্থার মাত্রা উল্লেখ করুন।
২. **Pull Request (PR)**: অ্যাপের ভেতরের **Names Editor** ব্যবহার করে বাংলা নাম লিখে **Export for GitHub PR** বাটনে ক্লিক করে `data/names_bn.json` ফাইলটি ডাউনলোড করুন এবং GitHub-এ PR পাঠান।
৩. **নিয়মাবলি**:
   - অনুমান করে কোনো নাম বানাবেন না; নিশ্চিত না হলে উৎস উল্লেখ করুন বা খালি রাখুন।
   - `bn` মান অবশ্যই বাংলা অক্ষরে হতে হবে।
   - PR পাঠানোর আগে `node scripts/validate_names.js` এবং `npm test` চালিয়ে যাচাই করুন।

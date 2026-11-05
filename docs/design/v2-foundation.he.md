# תשתית v2: פלטפורמת נתונים ומבנה כרטיס

סטטוס: **טיוטה לבדיקה** (zvimoe, itvikl) · ענף: `new-design` · מכסה את שלב 1 ב-[`overallplan`](../../overallplan), ואת תשתית האחסון ששלב 2 נשען עליה.

גרסה באנגלית: [v2-foundation.md](v2-foundation.md). אם יש הבדל בין הגרסאות, הגרסה באנגלית קובעת.

## 1. ההחלטות במסמך

| # | החלטה | למה |
|---|---|---|
| D1 | **PostgreSQL** במקום Firestore | הנתונים יחסיים: סביבות עבודה ← משתמשים ← תבניות ← עיצובים, נכסים וגופנים משותפים, הרשאות, מכסות, חיוב. ב-Postgres מסמכי הכרטיס נשמרים כ-`jsonb`, ו-`pgvector` מוסיף חיפוש חכם, כך שמסד נתונים אחד מכסה את כל התוכנית. |
| D2 | **AWS**: RDS Postgres, S3 + CloudFront, אפליקציית Next.js בקונטיינר ב-ECS Fargate, ובהמשך SQS + worker | עוזר ה-AI (Claude Agent SDK) מפעיל תהליך משנה, וייצוא בצד השרת צריך ספריות מערכת וגופנים. שניהם צריכים קונטיינר שרץ לאורך זמן, לא פונקציות serverless. |
| D3 | **נשארים עם אפליקציית Next.js אחת** (בלי NestJS) | Route handlers ושכבת נתונים עם טיפוסים נותנים את אותה הפרדה, בלי שירות שני שצריך לפרוס. |
| D4 | **סביבות עבודה (workspaces) מהיום הראשון** | כל רשומה שייכת לסביבת עבודה. לקוח פרטי מקבל סביבה אישית, עסק מקבל סביבה של חברה. כך B2B הוא פיצ'ר ולא העברת נתונים. |
| D5 | **מבנה כרטיס v2**: שלוש שכבות קבועות, נעילות לכל אלמנט, יותר סוגי אלמנטים | מבטל את בעיית סדר השכבות (באג אמיתי: בכרטיס שיובא נשמרה החתימה *מתחת* לתמונת הרקע), ומחליף את הדגל היחיד `editable` בכללי הנעילה של התוכנית. |
| D6 | **בונים קודם את הצד הפרטי** (עורך v2, העלאת גופנים, ייצוא PDF, תשלום להורדה), ואחריו את הפיצ'רים לעסקים | קודם הבסיס שכל לקוח צריך, ומעליו כלי הניהול לעסקים. |

מחוץ למסמך הזה: חיוב, ממשק ערכות מותג, צינור יצירת העיצובים, חיפוש חכם. הסכמה משאירה להם מקום (סעיף 3.3).

## 2. תשתית

| צורך | פרודקשן (AWS) | פיתוח מקומי |
|---|---|---|
| מסד נתונים | RDS PostgreSQL 16 + `pgvector` | Postgres ב-Docker (`docker compose up db`) |
| קבצים (תמונות, גופנים, ייצוא) | באקט S3 פרטי, מוגש דרך CloudFront | תיקייה מקומית `data/files/` מאחורי אותו ממשק |
| אפליקציה | קונטיינר ב-ECS Fargate מאחורי ALB | `npm run dev` |
| משימות רקע (רינדור באצ'ים, סטים של מודעות) | SQS + קונטיינר worker (שלב 3) | רץ ישירות |
| סודות | AWS Secrets Manager ← משתני סביבה | `.env.local` |

הגדרות (משתני סביבה): `DATABASE_URL`, `FILES_DRIVER=s3|local`, `S3_BUCKET`, `CDN_BASE_URL`, `ANTHROPIC_API_KEY`. הגדרות Firebase יוסרו אחרי העברת הנתונים (סעיף 6).

גישה מהקוד: **Prisma** לסכמה, למיגרציות ולשאילתות עם טיפוסים. הקובץ `db.ts` הנוכחי, שמותאם ל-Firestore (קורא את כל האוספים, משווה וכותב באצ'), מוחלף בפונקציות repository. הקוד שקורא לו מפסיק לקבל את כל אובייקט ה-`Db`.

## 3. מודל הנתונים

### 3.1 טבלאות

המזהים הם UUID. השדות `created_at` / `updated_at` קיימים בכל טבלה ולא מופיעים למטה.

```
workspaces      id, kind ('personal'|'company'), name, plan ('free'|'personal'|'business'), storage_quota_mb
users           id, email (unique, null for guests), name, password_hash, salt, platform_role ('admin'|'none')
memberships     workspace_id, user_id, role ('owner'|'manager'|'editor'|'viewer')        PK (workspace_id, user_id)
sessions        token_hash (PK), user_id, expires_at
topics          id, name, audience ('private'|'business'), cover_url, sort_order, hidden   -- home-page categories (today: CATEGORIES + carousel)
templates       id, workspace_id (null = platform catalogue), topic_id, name, status ('draft'|'published'),
                canvas jsonb (v2 doc), thumbnail_key, published_at
creatives       id, workspace_id, user_id, template_id, name, canvas jsonb (v2 doc), thumbnail_key
assets          id, workspace_id (null = platform), collection_id, kind ('image'|'svg'|'pattern'|'sticker'),
                file_key, width, height, metadata jsonb, embedding vector(…) (phase 5)
collections     id, workspace_id (null = platform), name, description               -- today's image "categories"
fonts           id, workspace_id (null = platform), family, weight, style, file_key, unicode_ranges
brand_kits      id, workspace_id, palette jsonb, typography jsonb                   -- table now, UI in phase 4
exports         id, creative_id, format ('png'|'pdf'), status, file_key             -- phase 3
```

### 3.2 מה עובר לאן

| היום (Firestore / `db.json`) | v2 |
|---|---|
| `Project` עם `kind: 'template'` | `templates` (קטלוג הפלטפורמה, `workspace_id` ריק) |
| `Project` עם `kind: 'design'` | `creatives`, בסביבה האישית של הבעלים |
| `Project.topic` + `CATEGORIES` + `CarouselSlide` | `topics` (שורה לכל קטגוריה: קהל, תמונת שער, סדר, הסתרה) |
| `Category` (תיקיית תמונות) | `collections`. שינוי שם: "קטגוריה" מעכשיו היא רק הנושא בדף הבית. |
| `ImageAsset` | `assets` (`kind: 'image'`) |
| `User.role: 'admin'` | `users.platform_role = 'admin'` |
| משתמש אורח לפי עוגייה | שורה ב-`users` בלי אימייל, וסביבה אישית שנוצרת בשמירה הראשונה |
| קובץ שהועלה `uploads/<file>` | מפתח S3 `assets/<workspace>/<id>.<ext>` |

### 3.3 כללי גישה

- **מנהל פלטפורמה**: הכול, כולל קטלוג הפלטפורמה ("מצב ניהול" של היום).
- **חבר בסביבת עבודה**: הרשומות של הסביבה שלו, לפי תפקיד. `editor` עורך עיצובים. `manager` גם עורך תבניות וערכות מותג של הסביבה. `owner` גם מנהל חברים וחיוב.
- **כולם**: תבניות שפורסמו בקטלוג, נושאים.

כל הבדיקות נמצאות במודול אחד (היורש של `access.ts`). ה-routes לא מסננים רשומות בעצמם.

## 4. מבנה כרטיס v2

### 4.1 המסמך

```ts
type CanvasDocV2 = {
  schema_version: 2;
  page: { width_mm: number; height_mm: number };
  layers: {
    background: BackgroundLayer;   // exactly one fill, optionally an image on top of it
    content: CanvasElement[];      // texts, shapes, dividers, content images
    overlay: CanvasElement[];      // stickers, frames, ribbons, user overlays
  };
};

type BackgroundLayer = {
  fill: Fill;                                  // always drawn
  image?: { asset_id: string; fit: 'cover' | 'contain'; colorOverride?: string };
  locks: Locks;                                // customer: swap image / change fill only if allowed
  field?: Field;
};
```

הסדר **בתוך** שכבה הוא סדר המערך. אין שדה `z`. כל שכבה מצוירת תמיד מעל השכבה שלפניה, כך שתוכן אף פעם לא יכול להגיע מתחת לרקע.

### 4.2 אלמנטים

```ts
type Base = {
  id: string;
  x_mm: number; y_mm: number; rotation: number;
  locks: Locks;
  field?: Field;          // shown to the customer as a form field
};

type Locks = {
  content: boolean;       // allowContentEdit: change text / swap image
  transform: boolean;     // allowTransform: move, resize, rotate
  delete: boolean;        // allowDelete
  style: boolean;         // change colour (today customers may change text colour)
};

type Field = { label: string; variable?: string };   // variable: e.g. 'event_name', for batch fill and the generator

type Fill =
  | { type: 'solid'; color: string }
  | { type: 'linear'; angle: number; stops: { offset: number; color: string }[] }
  | { type: 'radial'; stops: { offset: number; color: string }[] }
  | { type: 'pattern'; asset_id: string; scale: number };

type CanvasElement =
  | Base & { type: 'text'; w_mm: number; text: string; align: 'right' | 'center' | 'left';
             font: { family: string; weight: number; size_pt: number; color: string;
                     line_height?: number; letter_spacing?: number };
             fit?: 'none' | 'shrink' }                 // shrink: reduce size until the text fits w_mm (and h_mm if set)
  | Base & { type: 'image'; w_mm: number; h_mm: number; asset_id: string;
             mask?: 'none' | 'circle' | 'rounded' | { svg_asset_id: string };   // photo frames
             swap_collection_id?: string }
  | Base & { type: 'shape'; shape: 'rect' | 'ellipse' | 'line'; w_mm: number; h_mm: number;
             fill: Fill; stroke?: { color: string; width_mm: number }; radius_mm?: number }
  | Base & { type: 'svg'; w_mm: number; h_mm: number; asset_id: string; recolor?: Record<string, string> }  // stickers, badges
  | Base & { type: 'group'; children: CanvasElement[] };                      // text presets, smart grouping
```

`font.family` מפנה לשורה בטבלת `fonts`, כך שגופנים שהועלו עובדים בכל מקום שהגופנים המובנים עובדים.

### 4.3 אכיפה

`applyCustomerEdits` הופך ל-`applyEdits(stored, incoming, actor)`: לכל אלמנט בתבנית השמורה הוא לוקח מהמסמך שהגיע רק את מה שה-`locks` של האלמנט מתירים לאותו משתמש, ומתעלם מאלמנטים חדשים, אלא אם התבנית מתירה הוספות בשכבת ה-overlay. זה אותו כלל כמו היום (השרת לא סומך על הלקוח), רק כללי יותר. הכלים של עוזר ה-AI עוברים דרך אותה פונקציה, כך שהעוזר לא יכול לעשות יותר ממה שהמשתמש יכול.

ברירות מחדל: בתבנית, אלמנט חדש מקבל עבור לקוחות `{ content: true, transform: false, delete: false, style: true }` (מה ש-`editable: true` אומר היום). הרקע מקבל `{ content: false, … }`, אלא אם מי שבנה את התבנית התיר להחליף אותו.

### 4.4 העורך

- `Layer` אחד של Konva לכל שכבה בכרטיס. הרקע לא מגיב לעכבר, אלא אם הוא ניתן להחלפה ונבחר מהפאנל.
- בחירה, ידיות שינוי גודל והיסטוריה פועלים בתוך שכבה. "הבא קדימה / שלח אחורה" מזיזים רק בתוך השכבה.
- בפאנל האלמנטים של המנהל מתווסף בודק נעילות (ארבע תיבות סימון ושם השדה). הוא מחליף את המתג "ניתן לעריכה".

## 5. המרה מ-v1 ל-v2 (מסמכי כרטיס)

פונקציה טהורה `migrateV1(doc) → CanvasDocV2`, שרצה בקריאה עד שכל המסמכים השמורים הומרו, ואחר כך פעם אחת על כל מסד הנתונים:

1. `page.background` ← `layers.background.fill = { type: 'solid', color }`.
2. התמונה עם ה-`z` הנמוך ביותר שמכסה את כל הדף (±1 מ״מ) ← `layers.background.image`. השדות `swappable` / `swapCategoryId` / `colorOverride` / `label` שלה ממופים ל-`locks.content`, למזהה האוסף ול-`field`.
3. כל שאר האלמנטים, ממוינים לפי `z` ← `layers.content`. `rect` ← `shape: 'rect'`, `fill: { type: 'solid' }`.
4. טקסט עם `editable: true` ← `locks = { content: true, transform: true, delete: false, style: true }` (היום לקוחות יכולים גם לגרור טקסטים שניתנים לעריכה) ו-`field = { label }`. טקסט עם `editable: false` ← כל הנעילות `false`.
5. תמונה עם `swappable: true` ← `locks.content: true`, `swap_collection_id = swapCategoryId`.

כרטיס החתונה השבור מתוקן בשלבים 2–3: החתימה הופכת לאלמנט תוכן מעל הרקע.

כלי ייבוא המודעות (`examples/ad-import`) משתנה בהתאם: התמונה הנקייה נכנסת ל-`layers.background.image`, והמלבנים והטקסטים ל-`layers.content`.

## 6. העברת הנתונים

`scripts/migrate-to-postgres.ts`:

1. קורא את המקור: Firestore (עם הרשאות גישה) או `data/db.json` (`--from local`).
2. יוצר קטלוג פלטפורמה אחד (`workspace_id` ריק) לכל התבניות, וסביבה אישית לכל משתמש שיש לו עיצובים.
3. מכניס נושאים (מאחד את `CATEGORIES` עם הגדרות הקרוסלה), אוספים, נכסים, תבניות, עיצובים (הקנבס מומר עם `migrateV1`), משתמשים וחברויות. סשנים לא עוברים (כולם מתחברים מחדש).
4. מעתיק את הקבצים מ-Cloud Storage / `data/uploads` ל-S3 תחת המפתחות החדשים.
5. בודק את הספירות, ושכל קנבס עובר את `validateDocV2`. הוא מעדכן לפי מזהה (upsert), כך שאפשר להריץ אותו שוב לפני המעבר בלי ליצור כפילויות.

## 7. שינויים בקוד

| אזור | שינוי |
|---|---|
| `src/lib/db.ts`, `firebase.ts` | מוחלפים ב-`src/lib/data/*` (Prisma client, repository לכל ישות) וב-`src/lib/files.ts` (S3 / מקומי) |
| 14 הקבצים שמשתמשים ב-`readDb` / `updateDb` (API routes, `auth.ts`) | קוראים ל-repositories במקום לטעון הכול |
| `types.ts`, `canvas.ts` | טיפוסי v2, `validateDocV2`, `migrateV1`, `applyEdits` |
| `Editor.tsx` | שכבות Konva, בודק נעילות, סוגי אלמנטים חדשים (מילויים, צורות, svg, מסכות, קבוצות) |
| `agent/tools.ts` | מודל האלמנטים של v2, עריכות דרך `applyEdits` |
| `access.ts` | כללי סביבת עבודה ותפקיד (סעיף 3.3) |
| `examples/ad-import` | פלט v2 |
| חדש | העלאת גופנים (מנהל וסביבת עבודה), `docker-compose.yml` ל-Postgres, סכמת Prisma ומיגרציות |

דף הבית, הדלתות, הקרוסלה ודפי הקטגוריות שומרים על הממשק שלהם. רק הקריאות לנתונים משתנות.

## 8. סדר העבודה

1. **פלטפורמת נתונים**: סכמת Prisma, Postgres מקומי, repositories, ממשק הקבצים, התחברות מעל Postgres. האפליקציה רצה עם כרטיסי v1 שנשמרים ב-`jsonb`.
2. **סקריפט ההעברה**, שנבדק מול עותק של נתוני Firestore ושל `data/db.json`.
3. **מבנה כרטיס v2**: טיפוסים, ולידציה, `migrateV1`, `applyEdits`, שכבות בעורך ובודק נעילות, כלי העוזר, כלי הייבוא.
4. **העלאת גופנים** וסוגי האלמנטים החדשים.
5. **סביבת AWS**: RDS, S3/CloudFront, שירות ECS, פריסה אוטומטית (CI). אחר כך מריצים את ההעברה ועוברים.

כל שלב נבדק וממוזג ל-`new-design` בנפרד. `main` נשאר ניתן לפריסה על Firebase עד שלב 5.

## 9. שאלות פתוחות

1. **itvikl**: מסכים להחליף את Firestore ב-Postgres (D1)? יש משהו בפרודקשן על Firebase שצריך להמשיך לעבוד בזמן המעבר?
2. **חשבון AWS ואזור**: של מי החשבון, ו-`eu-central-1` (פרנקפורט) או `il-central-1` (תל אביב)?
3. **התחברות**: להשאיר אימייל וסיסמה משלנו (ואורחים), או לעבור לספק מנוהל (Cognito, Clerk) כשיגיעו חברות והזמנות?
4. **מי עובד על העורך בזמן בניית v2**: itvikl משנה את `Editor.tsx` ב-`main`. להקפיא שינויים בעורך ב-`main`, או למזג את `main` ל-`new-design` באופן קבוע?
5. **הוספות של לקוחות**: האם לקוחות פרטיים יכולים להוסיף מדבקות וטקסט משלהם (שכבת ה-overlay), או רק למלא שדות?

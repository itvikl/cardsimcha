# סביבות AWS של cardsimcha (AWS CDK)

כרגע: **staging** בתל אביב (`il-central-1`), בחשבון AWS נפרד של cardsimcha. הכל מוגדר בקוד ב-[lib/staging-stack.ts](lib/staging-stack.ts), לפי [מסמך התכנון](../docs/design/v2-foundation.md) (§2), בגודל קטן.

| חלק | מה | מחיר משוער (פועל כל החודש) |
|---|---|---|
| האפליקציה | ECS Fargate, ‏1 vCPU / 2 GB, משימה אחת. מיכל הפעלה מריץ את המיגרציות, ואז האפליקציה עולה | ‎$46 |
| מסד נתונים | RDS Postgres 16, ‏db.t4g.micro, ‏20 GB מוצפן, AZ אחד, הסיסמה ב-Secrets Manager | ‎$16 |
| Load balancer | ALB שרק CloudFront יכול להגיע אליו | ‎$20 |
| כתובות IP ציבוריות | 3 | ‎$11 |
| קבצים, HTTPS, לוגים | S3 פרטי, CloudFront (כתובת `*.cloudfront.net` עם HTTPS, בלי דומיין), CloudWatch לשבועיים | ‎$1–2 |

בסך הכל כ-‎$95 בחודש כשהסביבה פועלת כל הזמן. כשמכבים אותה (למטה) נשארים בערך ‎$35 (ה-ALB, הכתובות שלו והאחסון).

## פעם ראשונה

1. **חשבון AWS ל-cardsimcha**, עם אמצעי תשלום משלו. לא החשבון של PWTax.
2. **להפעיל את אזור תל אביב** בחשבון (Account → AWS Regions → Israel (Tel Aviv) → Enable). זה אזור שצריך להפעיל ידנית.
3. **משתמש מקומי:** `aws configure --profile cardsimcha`, ואז `set AWS_PROFILE=cardsimcha` (או `export` ב-bash).
4. **Bootstrap של CDK** (פעם אחת לחשבון ולאזור):
   ```
   cd infra
   npm install
   npx cdk bootstrap aws://<ACCOUNT_ID>/il-central-1
   ```

## פריסה

צריך Docker Desktop פועל: הפריסה בונה את ה-images מה-Dockerfile ומעלה אותם.

```
cd infra
npx cdk diff   -c account=<ACCOUNT_ID> -c adminEmail=<האימייל של המנהל>
npx cdk deploy -c account=<ACCOUNT_ID> -c adminEmail=<האימייל של המנהל> -c budgetEmail=<אימייל להתראות>
```

בסוף הפריסה מודפסת הכתובת (`Url`). נרשמים באתר עם האימייל שב-`adminEmail`, וזה הופך למנהל. פריסה חוזרת של אותה פקודה מעדכנת את הקוד, ומריצה מיגרציות חדשות לפני שהאפליקציה עולה.

**`budgetEmail`** (לא חובה): תקציב של ‎$120 בחודש, עם מייל ב-80% ומייל כשהתחזית עוברת אותו.

**העוזר וייבוא העיצוב:** צריך מפתח Anthropic (workspace נפרד ל-staging, עם תקרת הוצאה). שומרים אותו פעם אחת:
```
aws secretsmanager create-secret --region il-central-1 --name cardsimcha/staging/anthropic --secret-string <המפתח>
```
ומוסיפים לפריסה `-c anthropicSecretName=cardsimcha/staging/anthropic`. בלי המפתח העוזר פשוט מוסתר.

**נתונים:** הסביבה מתחילה עם מסד ריק. העברת הנתונים מ-Firebase ל-staging תיעשה בהמשך עם `npm run migrate:postgres` (צריך גישה זמנית למסד, שנמצא ברשת פרטית).

## כיבוי והדלקה

הסביבה עולה כסף רק כשהיא פועלת. השמות מודפסים בסוף הפריסה (`ClusterName`, `ServiceName`, `DbInstance`).

```
# כיבוי: האפליקציה לאפס משימות, ועצירת המסד
aws ecs update-service --region il-central-1 --cluster <ClusterName> --service <ServiceName> --desired-count 0
aws rds stop-db-instance --region il-central-1 --db-instance-identifier <DbInstance>

# הדלקה: קודם המסד (כמה דקות), אחר כך האפליקציה
aws rds start-db-instance --region il-central-1 --db-instance-identifier <DbInstance>
aws rds wait db-instance-available --region il-central-1 --db-instance-identifier <DbInstance>
aws ecs update-service --region il-central-1 --cluster <ClusterName> --service <ServiceName> --desired-count 1
```

AWS מדליק מסד עצור בעצמו אחרי 7 ימים. `npx cdk destroy` מוחק הכל חוץ מה-bucket של הקבצים, ומשאיר snapshot אחרון של המסד.

## בדיקה בלי AWS

`npx cdk synth -c account=111111111111 -c adminEmail=a@b.c` בונה את התבנית (`cdk.out/`) בלי גישה לחשבון: אזורי הזמינות כתובים בקוד ולא נשלפים מהחשבון.

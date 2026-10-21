"""Imports this example into the app's local data (data/db.json + data/uploads):
a new category holding the background image, and a published template made from canvas.json.
Run from anywhere: python examples/ad-import/import.py"""
import base64, datetime, io, json, os, random, shutil, uuid
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DATA = os.path.join(REPO, 'data')
db_path = os.path.join(DATA, 'db.json')
uploads = os.path.join(DATA, 'uploads')
os.makedirs(uploads, exist_ok=True)
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

empty = {'categories': [], 'images': [], 'projects': [], 'users': [], 'sessions': []}
db = {**empty, **json.load(open(db_path, encoding='utf8'))} if os.path.exists(db_path) else empty

cat = dict(id=str(uuid.uuid4()), name='מודעות - בדיקה ' + str(random.randint(100, 999)),
           description='קטגוריית בדיקה לייבוא מודעות', createdAt=now)
asset_id = str(uuid.uuid4())
shutil.copy(os.path.join(HERE, 'background.jpg'), os.path.join(uploads, asset_id + '.jpg'))
w, h = Image.open(os.path.join(HERE, 'background.jpg')).size
asset = dict(id=asset_id, categoryId=cat['id'], name='רקע - ורוד השטריימלך', file=asset_id + '.jpg',
             width=w, height=h, createdAt=now)

doc = json.load(open(os.path.join(HERE, 'canvas.json'), encoding='utf8'))
for e in doc['elements']:
    e['id'] = str(uuid.uuid4())  # fresh ids, so the example can be imported more than once
    if e['type'] == 'image' and e['asset_id'] == 'BACKGROUND':
        e['asset_id'] = asset_id

# gallery thumbnail; the editor replaces it with a real render on the first save
buf = io.BytesIO()
Image.open(os.path.join(HERE, 'preview.png')).convert('RGB').resize((600, 849)).save(buf, 'JPEG', quality=70)
owner = next((p.get('ownerId', '') for p in db['projects'] if p.get('kind') == 'template'), '')
project = dict(id=str(uuid.uuid4()), kind='template', ownerId=owner, status='published',
               name='מודעה - ורוד השטריימלך (ייבוא)', canvas=doc,
               thumbnail='data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode(),
               createdAt=now, updatedAt=now)

db['categories'].append(cat)
db['images'].append(asset)
db['projects'].append(project)
os.makedirs(DATA, exist_ok=True)
tmp = db_path + '.tmp'
with open(tmp, 'w', encoding='utf8') as f:
    json.dump(db, f, ensure_ascii=False, indent=2)
os.replace(tmp, db_path)
print('category:', cat['name'])
print('template: /editor/' + project['id'])

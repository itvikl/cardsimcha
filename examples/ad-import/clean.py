"""Removes the text that sits on the photo/gradient from source.jpg -> background.jpg.
Text on solid boxes is left alone: build.py covers it with rectangles."""
import os, cv2, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
im = cv2.imread(os.path.join(HERE, 'source.jpg'))
gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.int16)
mask = np.zeros(gray.shape, np.uint8)
# (x0,y0,x1,y1, threshold) regions whose text sits on the photo/gradient
regions = [
    (55, 92, 202, 728, 22),     # vertical "ורוד השטריימלך"
    (565, 178, 935, 232, 22),   # "ביום ראשון זה קורה"
    (55, 728, 422, 824, 22),    # two lines under the title box
    (500, 1368, 950, 1436, 22), # "מגוון..." two lines
    (400, 1438, 1060, 1512, 22),# day/date/time
    (400, 1512, 1065, 1565, 22),# address
]
for x0,y0,x1,y1,t in regions:
    reg = gray[y0:y1, x0:x1]
    k = 101 if min(reg.shape) > 101 else (min(reg.shape) // 2) * 2 - 1
    bg = cv2.medianBlur(np.clip(reg, 0, 255).astype(np.uint8), k).astype(np.int16)  # local background
    m = (np.abs(reg - bg) > t).astype(np.uint8) * 255
    m = cv2.dilate(m, np.ones((7,7), np.uint8))
    mask[y0:y1, x0:x1] = np.maximum(mask[y0:y1, x0:x1], m)
out = cv2.inpaint(im, mask, 9, cv2.INPAINT_TELEA)
# the big vertical text covers most of its box, so the median trick fails there:
# fill each column by blending the clean rows above and below it (the gradient is smooth)
out = out.astype(np.float32)
x0, x1, ya, yb = 50, 204, 88, 734
top = out[ya-4:ya].mean(axis=0)[x0:x1]
bot = out[yb:yb+4].mean(axis=0)[x0:x1]
t = np.linspace(0, 1, yb-ya)[:, None, None]
out[ya:yb, x0:x1] = top[None]*(1-t) + bot[None]*t
rng = np.random.default_rng(1)
out[ya:yb, x0:x1] += rng.normal(0, 1.5, out[ya:yb, x0:x1].shape)  # a bit of grain so it does not look flat
out = np.clip(out, 0, 255).astype(np.uint8)
cv2.imwrite(os.path.join(HERE, 'background.jpg'), out, [cv2.IMWRITE_JPEG_QUALITY, 92])

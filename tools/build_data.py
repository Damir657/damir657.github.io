"""Build the data files behind the homepage traffic demo.

Inputs (from the INEG 26103 project folder):
  - data/collected/tomtom_flow.csv  (laptop log) + the shared repo's copy (GitHub Actions log), merged
  - campus-map/data.js              (OpenStreetMap streets/buildings + UARK lot outlines)
  - TomTom Flow Segment Data API    (one call per road point, only to get each segment's shape)
Outputs:
  data/traffic.json   mean speed ratio per road x weekday x half hour, plus segment shapes
  data/basemap.json   simplified streets, buildings, green space and lots in local metres
"""
import json, math, os, sys
from pathlib import Path
import pandas as pd
import requests

SITE = Path(__file__).resolve().parents[1]
PROJ = Path.home() / "Documents/Operations Research Project"
REPO = Path.home() / "OR Github Repo/ineg26103-parking"
LAT0, LNG0 = 36.0686, -94.1748                       # Old Main: map origin
KX = 111_320 * math.cos(math.radians(LAT0)); KY = 110_540
BBOX = (36.0525, 36.0835, -94.1925, -94.1545)        # lat min/max, lng min/max

def xy(lat, lng):
    return [round((lng - LNG0) * KX), round((LAT0 - lat) * KY)]   # x east, y south (screen)

def inside(lat, lng):
    return BBOX[0] <= lat <= BBOX[1] and BBOX[2] <= lng <= BBOX[3]

# ---------- traffic ----------
frames = [pd.read_csv(p) for p in (PROJ / "data/collected/tomtom_flow.csv", REPO / "data/collected/tomtom_flow.csv") if p.exists()]
df = pd.concat(frames).drop_duplicates(subset=["timestamp_utc", "label"])
df = df[df.error.isna() & df.speed_ratio.notna()].copy()
t = pd.to_datetime(df.timestamp_local.str[:19])
df["dow"] = t.dt.dayofweek                     # 0 = Monday
df["slot"] = t.dt.hour * 2 + (t.dt.minute >= 30).astype(int)
SLOTS = list(range(12, 40))                     # 6:00 .. 19:30
wk = df[(df.dow < 5) & df.slot.isin(SLOTS)]

roads = []
key = None
for line in (PROJ / ".env").read_text().splitlines():
    if line.startswith("TOMTOM_API_KEY="):
        key = line.split("=", 1)[1].strip()
pts = df.groupby("label")[["lat", "lng"]].first()
for label, (lat, lng) in pts.iterrows():
    r = requests.get("https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/18/json",
                     params={"point": f"{lat},{lng}", "unit": "KMPH", "key": key}, timeout=20)
    r.raise_for_status()
    f = r.json()["flowSegmentData"]
    shape = [xy(c["latitude"], c["longitude"]) for c in f["coordinates"]["coordinate"]]
    g = wk[wk.label == label]
    grid = []
    for d in range(5):
        row = []
        for s in SLOTS:
            v = g[(g.dow == d) & (g.slot == s)].speed_ratio
            row.append(round(float(v.mean()), 3) if len(v) else None)
        grid.append(row)
    roads.append({"label": label, "freeFlow": int(f["freeFlowSpeed"]), "shape": shape,
                  "grid": grid, "n": int(len(g))})

traffic = {"slots": SLOTS, "days": ["Mon", "Tue", "Wed", "Thu", "Fri"], "roads": roads,
           "readings": int(len(df)), "first": str(t.min().date()), "last": str(t.max().date()),
           "dayCount": int(t.dt.date.nunique())}
(SITE / "data/traffic.json").write_text(json.dumps(traffic, separators=(",", ":")))

# ---------- basemap ----------
s = (PROJ / "campus-map/data.js").read_text()
cm = json.loads(s[s.index("{"): s.rindex("}") + 1])
O = cm["origin"]
def dec(flat):
    out = []
    for i in range(0, len(flat), 2):
        lat, lng = O[0] + flat[i] / O[2], O[1] + flat[i + 1] / O[2]
        out.append((lat, lng))
    return out
def poly_xy(flat, min_area=0):
    p = dec(flat)
    if not any(inside(a, b) for a, b in p):
        return None
    q = [xy(a, b) for a, b in p]
    if min_area:
        area = abs(sum(q[i][0] * q[i - 1][1] - q[i - 1][0] * q[i][1] for i in range(len(q)))) / 2
        if area < min_area:
            return None
    return [c for pt in q for c in pt]

base = cm["base"]
nodes = dec(base["nodes"])
ways = []
for w in base["ways"]:
    if w["k"] > 4:
        continue
    pts_ = [nodes[i] for i in w["n"]]
    if not any(inside(a, b) for a, b in pts_):
        continue
    ways.append({"k": w["k"], "p": [c for a, b in pts_ for c in xy(a, b)]})
blds = [b for b in (poly_xy(x["r"], 60) for x in base["buildings"]) if b]
green = [g for g in (poly_xy(x) for x in base["green"] + base["pitches"]) if g]
lots = []
for l in cm["lots"]:
    for poly in l["g"]:                     # each lot: list of polygons, each a list of rings
        p = poly_xy(poly[0])
        if p:
            lots.append(p)
basemap = {"ways": ways, "buildings": blds, "green": green, "lots": lots,
           "oldMain": xy(LAT0, LNG0)}
(SITE / "data/basemap.json").write_text(json.dumps(basemap, separators=(",", ":")))
print(f"traffic: {len(roads)} roads, {traffic['readings']} readings over {traffic['dayCount']} days; "
      f"basemap: {len(ways)} ways, {len(blds)} buildings, {len(green)} green, {len(lots)} lots")

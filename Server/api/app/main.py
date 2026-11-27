from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import math
import os
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone

import numpy as np
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, db
from .auth import admin_user, current_user, ensure_admin, hash_password, make_token, verify_password
from . import ai_api
from .ingest import ingest
from .model import fit_linear, k_from_rho0, rho0_to_ref

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init()
    await ensure_admin()
    await ingest.start()
    drift_task = asyncio.create_task(ai_api.drift_loop())
    yield
    drift_task.cancel()
    await ingest.stop()
    await db.close()


app = FastAPI(title="SSC Monitor API", version="0.1.0", lifespan=lifespan)


def _row(r):
    return {k: (v.isoformat() if isinstance(v, (datetime, date)) else v) for k, v in dict(r).items()}


def _online(last_seen: datetime | None) -> bool:
    return bool(last_seen) and (datetime.now(timezone.utc) - last_seen).total_seconds() < config.ONLINE_TIMEOUT_S


# ---------------------------------------------------------------- auth
class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/api/login")
async def login(body: LoginIn):
    async with db.pool.acquire() as con:
        u = await con.fetchrow("SELECT * FROM users WHERE username = $1", body.username)
    if not u or not verify_password(body.password, u["pw_hash"]):
        raise HTTPException(401, "Sai tên đăng nhập hoặc mật khẩu")
    return {"token": make_token(u["username"], u["role"]), "username": u["username"], "role": u["role"]}


@app.get("/api/me")
async def me(user=Depends(current_user)):
    return {"username": user["u"], "role": user["r"]}


@app.get("/api/health")
async def health():
    return {"ok": True, "mqtt": ingest.connected, "timescale": db.has_timescale, **ingest.stats}


# ---------------------------------------------------------------- users (admin)
class UserIn(BaseModel):
    username: str
    password: str = Field(min_length=6)
    role: str = Field(pattern="^(admin|viewer)$")


@app.get("/api/users")
async def list_users(_=Depends(admin_user)):
    async with db.pool.acquire() as con:
        rows = await con.fetch("SELECT id, username, role, created_at FROM users ORDER BY id")
    return [_row(r) for r in rows]


@app.post("/api/users")
async def create_user(body: UserIn, _=Depends(admin_user)):
    async with db.pool.acquire() as con:
        try:
            r = await con.fetchrow(
                "INSERT INTO users (username, pw_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role",
                body.username, hash_password(body.password), body.role)
        except Exception:
            raise HTTPException(400, "Tên đăng nhập đã tồn tại")
    return dict(r)


@app.delete("/api/users/{uid}")
async def delete_user(uid: int, user=Depends(admin_user)):
    async with db.pool.acquire() as con:
        name = await con.fetchval("SELECT username FROM users WHERE id = $1", uid)
        if name == user["u"]:
            raise HTTPException(400, "Không thể tự xoá tài khoản đang dùng")
        await con.execute("DELETE FROM users WHERE id = $1", uid)
    return {"ok": True}


# ---------------------------------------------------------------- sensors
class SensorIn(BaseModel):
    code: str
    name: str = ""
    mix: str = "F2"
    electrode_area_mm2: float = 2000
    electrode_gap_mm: float = 30
    load_area_mm2: float = 2500
    moisture_pct: float = 0
    location: str = ""
    cast_date: date | None = None
    note: str = ""


@app.get("/api/overview")
async def overview(_=Depends(current_user)):
    async with db.pool.acquire() as con:
        rows = await con.fetch(
            """SELECT s.*, d.id AS device_id, d.last_seen, d.rssi, d.fw,
                      m.id AS model_id, m.kind AS model_kind, m.k, m.r2, m.approved_at
               FROM sensors s
               LEFT JOIN devices d ON d.sensor_id = s.id
               LEFT JOIN calib_models m ON m.sensor_id = s.id AND m.active
               ORDER BY s.code""")
    out = []
    for r in rows:
        item = _row(r)
        item["online"] = _online(r["last_seen"])
        last = ingest.window(r["id"], 1.0)
        if last:
            arr = np.array([x[1:] for x in last], dtype=float)
            means = np.nanmean(arr, axis=0)
            item["latest"] = {k: (None if math.isnan(v) else float(v))
                              for k, v in zip(["us", "up", "rs", "rho", "stress", "temp", "rh"], means)}
            item["latest"]["load_kn"] = (item["latest"]["stress"] * r["load_area_mm2"] / 1000
                                         if item["latest"]["stress"] is not None else None)
        else:
            item["latest"] = None
        out.append(item)
    return out


@app.get("/api/sensors/{sid}")
async def get_sensor(sid: int, _=Depends(current_user)):
    async with db.pool.acquire() as con:
        s = await con.fetchrow("SELECT * FROM sensors WHERE id = $1", sid)
        if not s:
            raise HTTPException(404, "Không tìm thấy cục")
        d = await con.fetchrow("SELECT * FROM devices WHERE sensor_id = $1", sid)
        m = await con.fetchrow("SELECT * FROM calib_models WHERE sensor_id = $1 AND active", sid)
    res = _row(s)
    res["device"] = _row(d) if d else None
    if d:
        res["device"]["online"] = _online(d["last_seen"])
    res["model"] = _row(m) if m else None
    return res


@app.post("/api/sensors")
async def create_sensor(body: SensorIn, _=Depends(admin_user)):
    async with db.pool.acquire() as con:
        try:
            r = await con.fetchrow(
                """INSERT INTO sensors (code, name, mix, electrode_area_mm2, electrode_gap_mm, load_area_mm2,
                                        moisture_pct, location, cast_date, note)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *""",
                body.code, body.name, body.mix, body.electrode_area_mm2, body.electrode_gap_mm,
                body.load_area_mm2, body.moisture_pct, body.location, body.cast_date, body.note)
        except Exception:
            raise HTTPException(400, "Mã cục đã tồn tại")
    return _row(r)


@app.put("/api/sensors/{sid}")
async def update_sensor(sid: int, body: SensorIn, _=Depends(admin_user)):
    async with db.pool.acquire() as con:
        r = await con.fetchrow(
            """UPDATE sensors SET code=$2, name=$3, mix=$4, electrode_area_mm2=$5, electrode_gap_mm=$6,
                   load_area_mm2=$7, moisture_pct=$8, location=$9, cast_date=$10, note=$11
               WHERE id=$1 RETURNING *""",
            sid, body.code, body.name, body.mix, body.electrode_area_mm2, body.electrode_gap_mm,
            body.load_area_mm2, body.moisture_pct, body.location, body.cast_date, body.note)
    ingest.invalidate()
    if not r:
        raise HTTPException(404, "Không tìm thấy cục")
    return _row(r)


@app.delete("/api/sensors/{sid}")
async def delete_sensor(sid: int, _=Depends(admin_user)):
    async with db.pool.acquire() as con:
        await con.execute("DELETE FROM sensors WHERE id = $1", sid)
    ingest.invalidate()
    return {"ok": True}


# ---------------------------------------------------------------- devices
class DevicePatch(BaseModel):
    sensor_id: int | None = None
    rr_ohm: float | None = None


@app.get("/api/devices")
async def list_devices(_=Depends(current_user)):
    """Chỉ các mạch đã ghép. Mạch mới phải được ghép bằng mã 6 số (POST /api/devices/pair)."""
    async with db.pool.acquire() as con:
        rows = await con.fetch(
            """SELECT d.*, s.code AS sensor_code FROM devices d
               LEFT JOIN sensors s ON s.id = d.sensor_id WHERE d.paired ORDER BY d.id""")
    out = []
    for r in rows:
        item = _row(r)
        item.pop("pair_code", None)
        item["online"] = _online(r["last_seen"])
        out.append(item)
    return out


@app.get("/api/devices/pending")
async def pending_devices(_=Depends(current_user)):
    """Số mạch đang bật, đã gửi mã ghép nhưng chưa được ghép (không trả mã)."""
    async with db.pool.acquire() as con:
        rows = await con.fetch("SELECT last_seen FROM devices WHERE NOT paired AND pair_code IS NOT NULL")
    return {"count": sum(1 for r in rows if _online(r["last_seen"]))}


class PairIn(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")
    sensor_id: int | None = None
    rr_ohm: float | None = Field(default=None, gt=0)


_pair_fails: list[float] = []   # thời điểm nhập sai, chặn dò mã


@app.post("/api/devices/pair")
async def pair_device(body: PairIn, _=Depends(admin_user)):
    now = time.time()
    _pair_fails[:] = [t for t in _pair_fails if now - t < 600]
    if len(_pair_fails) >= 10:
        raise HTTPException(429, "Nhập sai quá nhiều lần. Đợi vài phút rồi thử lại.")
    async with db.pool.acquire() as con:
        async with con.transaction():
            rows = await con.fetch(
                "SELECT id, last_seen FROM devices WHERE NOT paired AND pair_code = $1 FOR UPDATE", body.code)
            rows = [r for r in rows if _online(r["last_seen"])]
            if not rows:
                _pair_fails.append(now)
                raise HTTPException(404, "Không có mạch nào đang chờ ghép với mã này. Kiểm tra mạch đã bật, "
                                         "đã vào Wi-Fi và mã đúng như trên mạch.")
            if len(rows) > 1:
                raise HTTPException(409, "Có nhiều mạch trùng mã này. Khởi động lại một mạch để nó tạo mã khác.")
            did = rows[0]["id"]
            await con.execute("UPDATE devices SET paired = true, pair_code = NULL WHERE id = $1", did)
            if body.sensor_id is not None:
                await con.execute("UPDATE devices SET sensor_id = NULL WHERE sensor_id = $1", body.sensor_id)
                await con.execute("UPDATE devices SET sensor_id = $2 WHERE id = $1", did, body.sensor_id)
            if body.rr_ohm is not None:
                await con.execute("UPDATE devices SET rr_ohm = $2 WHERE id = $1", did, body.rr_ohm)
    ingest.publish_paired(did, True)
    ingest.invalidate()
    return {"ok": True, "id": did}


@app.patch("/api/devices/{did}")
async def patch_device(did: str, body: DevicePatch, _=Depends(admin_user)):
    async with db.pool.acquire() as con:
        if not await con.fetchval("SELECT paired FROM devices WHERE id = $1", did):
            raise HTTPException(404, "Mạch chưa được ghép")
        async with con.transaction():
            if "sensor_id" in body.model_fields_set:
                if body.sensor_id is not None:
                    await con.execute("UPDATE devices SET sensor_id = NULL WHERE sensor_id = $1", body.sensor_id)
                await con.execute("UPDATE devices SET sensor_id = $2 WHERE id = $1", did, body.sensor_id)
            if body.rr_ohm is not None:
                await con.execute("UPDATE devices SET rr_ohm = $2 WHERE id = $1", did, body.rr_ohm)
    ingest.invalidate()
    return {"ok": True}


@app.post("/api/devices/{did}/config")
async def device_config(did: str, cfg: dict, _=Depends(admin_user)):
    async with db.pool.acquire() as con:
        await con.execute("UPDATE devices SET config = $2::jsonb WHERE id = $1", did, json.dumps(cfg))
    ingest.publish_config(did, cfg)
    return {"ok": True}


@app.delete("/api/devices/{did}")
async def delete_device(did: str, _=Depends(admin_user)):
    async with db.pool.acquire() as con:
        await con.execute("DELETE FROM devices WHERE id = $1", did)
    ingest.publish_paired(did, False)   # mạch quay về trạng thái chờ ghép, hiện lại mã
    ingest.invalidate()
    return {"ok": True}


# ---------------------------------------------------------------- data
@app.get("/api/sensors/{sid}/live")
async def live(sid: int, since: float = 0, _=Depends(current_user)):
    if since <= 0:
        since = time.time() * 1000 - 30_000
    pts = ingest.live_since(sid, since)
    keys = ["t", "us", "up", "rs", "rho", "stress", "temp", "rh", "stress_lo", "stress_hi"]
    out = {k: [p[i] if i < len(p) else None for p in pts] for i, k in enumerate(keys)}
    out["flag"] = ingest.flags.get(sid)   # cờ của mô hình lai: ok | prior | no_zero | no_reference | out_of_range
    return out


def _pick_bucket(span_s: float) -> int:
    for b in (1, 2, 5, 10, 30, 60, 300, 900, 3600):
        if span_s / b <= 2000:
            return b
    return 3600 * 6


@app.get("/api/sensors/{sid}/series")
async def series(sid: int, start: datetime | None = None, end: datetime | None = None,
                 _=Depends(current_user)):
    end = end or datetime.now(timezone.utc)
    start = start or end - timedelta(hours=1)
    span = (end - start).total_seconds()
    b = _pick_bucket(span)
    if db.has_timescale and b >= 60:
        src = "samples_1m"
    elif db.has_timescale and b >= 1 and span > 600:
        src = "samples_1s"
    else:
        src = "samples"
    sql = f"""SELECT {db.bucket_expr(b)} AS t, avg(rho) AS rho, min(rho) AS rho_min, max(rho) AS rho_max,
                     avg(stress) AS stress, avg(rs) AS rs, avg(temp) AS temp, avg(rh) AS rh
              FROM {src} WHERE sensor_id = $1 AND time >= $2 AND time < $3
              GROUP BY 1 ORDER BY 1"""
    async with db.pool.acquire() as con:
        try:
            rows = await con.fetch(sql, sid, start, end)
        except Exception:
            rows = await con.fetch(sql.replace(f"FROM {src}", "FROM samples"), sid, start, end)
    keys = ["rho", "rho_min", "rho_max", "stress", "rs", "temp", "rh"]
    res = {"bucket_s": b, "t": [r["t"].timestamp() * 1000 for r in rows]}
    for k in keys:
        res[k] = [r[k] for r in rows]
    return res


@app.get("/api/sensors/{sid}/export")
async def export(sid: int, start: datetime, end: datetime,
                 resolution: str = Query("raw", pattern="^(raw|1s|1m)$"),
                 fmt: str = Query("csv", pattern="^(csv|parquet)$"),
                 _=Depends(current_user)):
    """Dataset for AI/analysis: CSV streams; Parquet loads into pandas directly."""
    if resolution == "raw":
        sql = "SELECT time, us, up, rs, rho, stress, temp, rh FROM samples WHERE sensor_id=$1 AND time>=$2 AND time<$3 ORDER BY time"
    else:
        b = 1 if resolution == "1s" else 60
        sql = f"""SELECT {db.bucket_expr(b)} AS time, avg(us) us, avg(up) up, avg(rs) rs, avg(rho) rho,
                         avg(stress) stress, avg(temp) temp, avg(rh) rh
                  FROM samples WHERE sensor_id=$1 AND time>=$2 AND time<$3 GROUP BY 1 ORDER BY 1"""
    name = f"ssc_{sid}_{start:%Y%m%d%H%M}_{end:%Y%m%d%H%M}_{resolution}"
    if fmt == "parquet":
        import pandas as pd
        async with db.pool.acquire() as con:
            rows = await con.fetch(sql, sid, start, end)
        df = pd.DataFrame([dict(r) for r in rows])
        buf = io.BytesIO()
        df.to_parquet(buf, index=False)
        buf.seek(0)
        return StreamingResponse(buf, media_type="application/octet-stream",
                                 headers={"Content-Disposition": f'attachment; filename="{name}.parquet"'})

    async def gen():
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["time", "us", "up", "rs", "rho", "stress", "temp", "rh"])
        async with db.pool.acquire() as con:
            async with con.transaction():
                async for r in con.cursor(sql, sid, start, end, prefetch=5000):
                    w.writerow([r["time"].isoformat(), *[r[k] for k in ("us", "up", "rs", "rho", "stress", "temp", "rh")]])
                    if out.tell() > 1 << 16:
                        yield out.getvalue()
                        out.seek(0)
                        out.truncate()
        yield out.getvalue()

    return StreamingResponse(gen(), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})


# ---------------------------------------------------------------- calibration
class RunIn(BaseModel):
    sensor_id: int
    note: str = ""


class StepIn(BaseModel):
    load_kn: float
    window_s: float = Field(3.0, ge=0.5, le=60)


@app.post("/api/calib/runs")
async def create_run(body: RunIn, user=Depends(admin_user)):
    async with db.pool.acquire() as con:
        r = await con.fetchrow(
            "INSERT INTO calib_runs (sensor_id, note, created_by) VALUES ($1, $2, $3) RETURNING *",
            body.sensor_id, body.note, user["u"])
    return _row(r)


@app.get("/api/calib/runs")
async def list_runs(sensor_id: int, _=Depends(current_user)):
    async with db.pool.acquire() as con:
        rows = await con.fetch(
            """SELECT r.*, count(s.id) AS n_steps FROM calib_runs r
               LEFT JOIN calib_steps s ON s.run_id = r.id
               WHERE r.sensor_id = $1 GROUP BY r.id ORDER BY r.id DESC""", sensor_id)
    return [_row(r) for r in rows]


@app.get("/api/calib/runs/{rid}")
async def get_run(rid: int, _=Depends(current_user)):
    async with db.pool.acquire() as con:
        r = await con.fetchrow("SELECT * FROM calib_runs WHERE id = $1", rid)
        if not r:
            raise HTTPException(404, "Không tìm thấy lần hiệu chuẩn")
        steps = await con.fetch("SELECT * FROM calib_steps WHERE run_id = $1 ORDER BY id", rid)
        models = await con.fetch("SELECT * FROM calib_models WHERE run_id = $1 ORDER BY id DESC", rid)
    return {**_row(r), "steps": [_row(s) for s in steps], "models": [_row(m) for m in models]}


@app.post("/api/calib/runs/{rid}/steps")
async def add_step(rid: int, body: StepIn, _=Depends(admin_user)):
    """Record one load step: average the last `window_s` seconds of live signal at the entered load."""
    async with db.pool.acquire() as con:
        run = await con.fetchrow(
            "SELECT r.*, s.load_area_mm2 FROM calib_runs r JOIN sensors s ON s.id = r.sensor_id WHERE r.id = $1", rid)
    if not run:
        raise HTTPException(404, "Không tìm thấy lần hiệu chuẩn")
    win = ingest.window(run["sensor_id"], body.window_s)
    if len(win) < 10:
        raise HTTPException(409, "Chưa có tín hiệu trực tiếp từ cục này (thiết bị offline hoặc chưa gán cục)")
    arr = np.array([x[1:] for x in win], dtype=float)
    rho = arr[:, 3]
    stress = body.load_kn * 1000.0 / run["load_area_mm2"]  # N/mm² = MPa
    vals = dict(
        rho=float(np.nanmean(rho)), rho_std=float(np.nanstd(rho)), rs=float(np.nanmean(arr[:, 2])),
        temp=_nanmean(arr[:, 5]), rh=_nanmean(arr[:, 6]),
    )
    t_from = datetime.fromtimestamp(win[0][0] / 1000, tz=timezone.utc)
    t_to = datetime.fromtimestamp(win[-1][0] / 1000, tz=timezone.utc)
    async with db.pool.acquire() as con:
        r = await con.fetchrow(
            """INSERT INTO calib_steps (run_id, load_kn, stress_mpa, rho, rho_std, rs, temp, rh, n_samples, t_from, t_to)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *""",
            rid, body.load_kn, stress, vals["rho"], vals["rho_std"], vals["rs"], vals["temp"], vals["rh"],
            len(win), t_from, t_to)
    return _row(r)


@app.delete("/api/calib/steps/{step_id}")
async def delete_step(step_id: int, _=Depends(admin_user)):
    async with db.pool.acquire() as con:
        await con.execute("DELETE FROM calib_steps WHERE id = $1", step_id)
    return {"ok": True}


@app.post("/api/calib/runs/{rid}/fit")
async def fit_run(rid: int, _=Depends(admin_user)):
    async with db.pool.acquire() as con:
        run = await con.fetchrow(
            "SELECT r.*, s.moisture_pct, s.mix FROM calib_runs r JOIN sensors s ON s.id = r.sensor_id WHERE r.id = $1", rid)
        steps = await con.fetch("SELECT * FROM calib_steps WHERE run_id = $1 ORDER BY id", rid)
    if not run:
        raise HTTPException(404, "Không tìm thấy lần hiệu chuẩn")
    try:
        f = fit_linear([s["stress_mpa"] for s in steps], [s["rho"] for s in steps])
    except ValueError as e:
        raise HTTPException(400, str(e))
    temps = [s["temp"] for s in steps if s["temp"] is not None]
    t = float(np.mean(temps)) if temps else 20.0
    w = run["moisture_pct"]
    rho0_ref = rho0_to_ref(f["rho0"], t, w) if f["rho0"] > 0 else None
    params = {"intercept": f["intercept"], "k_eq": k_from_rho0(f["rho0"], run["mix"]),
              "points": [[s["stress_mpa"], s["rho"]] for s in steps]}
    async with db.pool.acquire() as con:
        m = await con.fetchrow(
            """INSERT INTO calib_models (sensor_id, run_id, kind, k, rho0, rho0_ref, temp, moisture, r2, rmse_mpa, params)
               VALUES ($1,$2,'linear',$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *""",
            run["sensor_id"], rid, f["k"], f["rho0"], rho0_ref, t, w, f["r2"], f["rmse_mpa"],
            json.dumps(params))
        await con.execute("UPDATE calib_runs SET status = 'fitted' WHERE id = $1", rid)
    return _row(m)


@app.post("/api/sensors/{sid}/models/eq14")
async def model_from_eq14(sid: int, window_s: float = 5.0, _=Depends(admin_user)):
    """No press available: measure unloaded rho now and take K from Eq. 14/15 for the sensor's mix."""
    async with db.pool.acquire() as con:
        s = await con.fetchrow("SELECT * FROM sensors WHERE id = $1", sid)
    if not s:
        raise HTTPException(404, "Không tìm thấy cục")
    win = ingest.window(sid, window_s)
    if len(win) < 10:
        raise HTTPException(409, "Chưa có tín hiệu trực tiếp từ cục này")
    arr = np.array([x[1:] for x in win], dtype=float)
    rho0 = float(np.nanmean(arr[:, 3]))
    t = _nanmean(arr[:, 5]) or 20.0
    k = k_from_rho0(rho0, s["mix"])
    if k is None:
        raise HTTPException(400, f"Chưa có phương trình K cho cấp phối {s['mix']}")
    async with db.pool.acquire() as con:
        m = await con.fetchrow(
            """INSERT INTO calib_models (sensor_id, kind, k, rho0, rho0_ref, temp, moisture, params)
               VALUES ($1,'eq14',$2,$3,$4,$5,$6,'{}'::jsonb) RETURNING *""",
            sid, k, rho0, rho0_to_ref(rho0, t, s["moisture_pct"]), t, s["moisture_pct"])
    return _row(m)


@app.get("/api/sensors/{sid}/models")
async def list_models(sid: int, _=Depends(current_user)):
    async with db.pool.acquire() as con:
        rows = await con.fetch("SELECT * FROM calib_models WHERE sensor_id = $1 ORDER BY id DESC", sid)
    return [_row(r) for r in rows]


@app.post("/api/calib/models/{mid}/approve")
async def approve_model(mid: int, user=Depends(admin_user)):
    async with db.pool.acquire() as con:
        async with con.transaction():
            m = await con.fetchrow("SELECT * FROM calib_models WHERE id = $1", mid)
            if not m:
                raise HTTPException(404, "Không tìm thấy mô hình")
            await con.execute("UPDATE calib_models SET active = false WHERE sensor_id = $1", m["sensor_id"])
            await con.execute(
                "UPDATE calib_models SET active = true, approved_by = $2, approved_at = now() WHERE id = $1",
                mid, user["u"])
            await con.execute("UPDATE sensors SET rho0_ref = $2 WHERE id = $1", m["sensor_id"], m["rho0_ref"])
    ingest.invalidate()
    return {"ok": True}


def _nanmean(a):
    a = np.asarray(a, dtype=float)
    return None if np.all(np.isnan(a)) else float(np.nanmean(a))


app.include_router(ai_api.router)   # mô hình AI lai: /api/ai/*, /api/sensors/{id}/models/hybrid, ...


# ---------------------------------------------------------------- web (built React app)
if os.path.isdir(config.STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(config.STATIC_DIR, "assets")), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        f = os.path.join(config.STATIC_DIR, path)
        if path and os.path.isfile(f):
            return FileResponse(f)
        return FileResponse(os.path.join(config.STATIC_DIR, "index.html"))

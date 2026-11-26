"""API cho mô hình AI lai: template dữ liệu, thu thập tự động, huấn luyện, mốc lắp đặt, kiểm tra trôi."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timedelta, timezone

import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field

from . import assistant, dataset, db, hybrid
from .auth import admin_user, current_user
from .ingest import ingest

log = logging.getLogger("ssc.ai")
router = APIRouter(prefix="/api")
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _row(r):
    return {k: (v.isoformat() if isinstance(v, (datetime, date)) else v) for k, v in dict(r).items()}


def _nanmean(a):
    a = np.asarray(a, dtype=float)
    return None if a.size == 0 or np.all(np.isnan(a)) else float(np.nanmean(a))


def _live(sensor_id: int, window_s: float, need: int = 10):
    """Trung bình tín hiệu trực tiếp vài giây gần nhất: (rho, rho_std, temp, rh, n, t_from, t_to)."""
    win = ingest.window(sensor_id, window_s)
    if len(win) < need:
        return None
    arr = np.array([x[1:] for x in win], dtype=float)
    return {"rho": float(np.nanmean(arr[:, 3])), "rho_std": float(np.nanstd(arr[:, 3])),
            "temp": _nanmean(arr[:, 5]), "rh": _nanmean(arr[:, 6]), "n": len(win),
            "t_from": datetime.fromtimestamp(win[0][0] / 1000, tz=timezone.utc),
            "t_to": datetime.fromtimestamp(win[-1][0] / 1000, tz=timezone.utc)}


async def _sensor(con, sid: int):
    s = await con.fetchrow("SELECT * FROM sensors WHERE id = $1", sid)
    if not s:
        raise HTTPException(404, "Không tìm thấy cục")
    return s


# ---------------------------------------------------------------- template và dữ liệu
@router.get("/ai/template.xlsx")
async def template(_=Depends(current_user)):
    return Response(dataset.write_template(), media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="SSC_template_du_lieu.xlsx"'})


@router.get("/ai/dataset.xlsx")
async def export_dataset(_=Depends(current_user)):
    """Toàn bộ dữ liệu huấn luyện đã thu (nhập tay + tự động), đúng mẫu template."""
    async with db.pool.acquire() as con:
        sensors = await con.fetch("SELECT s.*, r.code AS ref_code FROM sensors s LEFT JOIN sensors r ON r.id = s.reference_sensor_id ORDER BY s.code")
        temps = await con.fetch("SELECT t.*, s.code FROM calib_temp_steps t JOIN sensors s ON s.id = t.sensor_id ORDER BY t.id")
        steps = await con.fetch("""SELECT st.*, r.id AS run, s.code FROM calib_steps st JOIN calib_runs r ON r.id = st.run_id
                                   JOIN sensors s ON s.id = r.sensor_id ORDER BY st.id""")
        ins = await con.fetch("SELECT i.*, s.code FROM install_readings i JOIN sensors s ON s.id = i.sensor_id ORDER BY i.id")
        chk = await con.fetch("SELECT c.*, s.code FROM field_checks c JOIN sensors s ON s.id = c.sensor_id ORDER BY c.id")
    rows = {
        "Cuc": [{"ma_cuc": s["code"], "cap_phoi": s["mix"], "me_duc": s["batch"], "ngay_duc": s["cast_date"],
                 "cuong_do_nen_mpa": s["fc_mpa"], "dien_tich_dien_cuc_mm2": s["electrode_area_mm2"],
                 "khoang_cach_dien_cuc_mm": s["electrode_gap_mm"], "dien_tich_chiu_nen_mm2": s["load_area_mm2"],
                 "la_cuc_doi_chung": "co" if s["is_reference"] else "", "ma_cuc_doi_chung": s["ref_code"] or "",
                 "vi_tri": s["location"], "ghi_chu": s["note"]} for s in sensors],
        "QuetNhiet": [{"ma_cuc": t["code"], "thoi_diem": t["t_from"], "nhiet_do_c": t["temp"], "do_am_pct": t["moisture"],
                       "rho_ohm_m": t["rho"], "rho_std": t["rho_std"], "so_mau": t["n_samples"], "ghi_chu": t["source"]} for t in temps],
        "LapDat": [{"ma_cuc": i["code"], "thoi_diem": i["time"], "rho0_ohm_m": i["rho0"], "nhiet_do_c": i["temp"],
                    "do_am_pct": i["moisture"], "rho_doi_chung_ohm_m": i["rho_ref"], "ghi_chu": i["source"]} for i in ins],
        "KiemChung": [{"ma_cuc": c["code"], "thoi_diem": c["time"], "ung_suat_that_mpa": c["stress_true"], "rho_ohm_m": c["rho"],
                       "nhiet_do_c": c["temp"], "do_am_pct": c["moisture"], "rho_doi_chung_ohm_m": c["rho_ref"],
                       "ghi_chu": c["source"]} for c in chk],
    }
    # chu kỳ: mỗi lần ép là một run; trong run, một chu kỳ mới bắt đầu khi tải quay về bậc nhỏ nhất sau khi đã tăng
    ep = []
    by_run = {}
    for st in steps:
        by_run.setdefault(st["run"], []).append(st)
    for run, sts in by_run.items():
        cyc, rising_seen, smin = 1, False, min(x["stress_mpa"] for x in sts)
        for x in sts:
            if x["stress_mpa"] <= smin + 1e-9 and rising_seen:
                cyc += 1; rising_seen = False
            if x["stress_mpa"] > smin + 1e-9:
                rising_seen = True
            ep.append({"ma_cuc": x["code"], "lan_ep": run, "chu_ky": cyc, "tai_kn": x["load_kn"], "ung_suat_mpa": x["stress_mpa"],
                       "rho_ohm_m": x["rho"], "rs_ohm": x["rs"], "rho_std": x["rho_std"], "nhiet_do_c": x["temp"],
                       "thoi_diem": x["t_from"]})
    rows["EpBac"] = ep
    return Response(dataset.write_template(rows), media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="SSC_du_lieu_huan_luyen.xlsx"'})


@router.post("/ai/import")
async def import_dataset(file: UploadFile = File(...), user=Depends(admin_user)):
    """Nhập file template đã điền: tạo/cập nhật cục, thêm bậc ép, quét nhiệt, mốc lắp đặt, kiểm chứng."""
    tables, errors = dataset.read_template(await file.read())
    async with db.pool.acquire() as con:
        async with con.transaction():
            # cục chỉ được nhắc tới (không có trong sheet Cuc) thì lấy từ hệ thống
            tables["Cuc"] = tables["Cuc"] + await _db_blocks(con, {b["ma_cuc"] for b in tables["Cuc"]})
            dataset.check_tables(tables, errors)
            counts = await _store(con, tables, f"Nhập từ {file.filename}", user["u"])
    ingest.invalidate()
    return {"counts": counts, "errors": errors}


async def _db_blocks(con, skip: set) -> list[dict]:
    rows = await con.fetch("SELECT * FROM sensors")
    return [{"_db": True, "_id": r["id"], "ma_cuc": r["code"], "cap_phoi": r["mix"], "dien_tich_dien_cuc_mm2": r["electrode_area_mm2"],
             "khoang_cach_dien_cuc_mm": r["electrode_gap_mm"], "dien_tich_chiu_nen_mm2": r["load_area_mm2"],
             "cuong_do_nen_mpa": r["fc_mpa"], "la_cuc_doi_chung": "co" if r["is_reference"] else ""}
            for r in rows if r["code"] not in skip]


async def _store(con, tables: dict, label: str, username: str) -> dict:
    """Ghi các bảng (đã kiểm tra) vào DB. Trả về số dòng mỗi sheet."""
    counts = {k: 0 for k in dataset.SHEETS}
    ids = {b["ma_cuc"]: b["_id"] for b in tables["Cuc"] if b.get("_db")}
    new_blocks = [b for b in tables["Cuc"] if not b.get("_db")]
    for b in new_blocks:
        r = await con.fetchrow(
            """INSERT INTO sensors (code, mix, batch, cast_date, fc_mpa, electrode_area_mm2, electrode_gap_mm,
                                    load_area_mm2, is_reference, location, note)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
               ON CONFLICT (code) DO UPDATE SET mix=EXCLUDED.mix, batch=EXCLUDED.batch,
                 cast_date=coalesce(EXCLUDED.cast_date, sensors.cast_date), fc_mpa=coalesce(EXCLUDED.fc_mpa, sensors.fc_mpa),
                 electrode_area_mm2=EXCLUDED.electrode_area_mm2, electrode_gap_mm=EXCLUDED.electrode_gap_mm,
                 load_area_mm2=EXCLUDED.load_area_mm2, is_reference=EXCLUDED.is_reference,
                 location=EXCLUDED.location, note=EXCLUDED.note
               RETURNING id""",
            b["ma_cuc"], str(b.get("cap_phoi") or "F2").upper(), str(b.get("me_duc") or ""),
            _date(b.get("ngay_duc")), dataset._num(b.get("cuong_do_nen_mpa")),
            float(b["dien_tich_dien_cuc_mm2"]), float(b["khoang_cach_dien_cuc_mm"]), float(b["dien_tich_chiu_nen_mm2"]),
            str(b.get("la_cuc_doi_chung") or "").lower().startswith("c"), str(b.get("vi_tri") or ""),
            str(b.get("ghi_chu") or ""))
        ids[b["ma_cuc"]] = r["id"]; counts["Cuc"] += 1
    for b in new_blocks:
        ref = str(b.get("ma_cuc_doi_chung") or "").strip()
        if ref:
            ref_id = ids.get(ref) or await con.fetchval("SELECT id FROM sensors WHERE code = $1", ref)
            await con.execute("UPDATE sensors SET reference_sensor_id = $2 WHERE id = $1", ids[b["ma_cuc"]], ref_id)
    src = "web" if label.endswith("web") else "import"
    for t in tables["QuetNhiet"]:
        ts = _ts(t.get("thoi_diem"))
        await con.execute(
            """INSERT INTO calib_temp_steps (sensor_id, temp, moisture, rho, rho_std, n_samples, t_from, t_to, source)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8)""",
            ids[t["ma_cuc"]], float(t["nhiet_do_c"]), dataset._num(t.get("do_am_pct")), float(t["rho_ohm_m"]),
            dataset._num(t.get("rho_std")), int(dataset._num(t.get("so_mau")) or 0), ts, src)
        counts["QuetNhiet"] += 1
    runs = {}
    blocks = {b["ma_cuc"]: b for b in tables["Cuc"]}
    for st in tables["EpBac"]:
        key = (st["ma_cuc"], str(st["lan_ep"]))
        if key not in runs:
            runs[key] = await con.fetchval(
                "INSERT INTO calib_runs (sensor_id, note, created_by, status) VALUES ($1,$2,$3,'open') RETURNING id",
                ids[st["ma_cuc"]], f"{label}, lần ép {st['lan_ep']}", username)
        ts = _ts(st.get("thoi_diem")) or datetime.now(timezone.utc)
        area = float(blocks[st["ma_cuc"]]["dien_tich_chiu_nen_mm2"])
        s = float(st["ung_suat_mpa"])
        await con.execute(
            """INSERT INTO calib_steps (run_id, load_kn, stress_mpa, rho, rho_std, rs, temp, rh, n_samples, t_from, t_to)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)""",
            runs[key], dataset._num(st.get("tai_kn")) if dataset._num(st.get("tai_kn")) is not None else s * area / 1000, s,
            float(st["rho_ohm_m"]), dataset._num(st.get("rho_std")), dataset._num(st.get("rs_ohm")), float(st["nhiet_do_c"]),
            dataset._num(st.get("do_am_pct")), int(dataset._num(st.get("so_mau")) or 0), ts)
        counts["EpBac"] += 1
    for i in tables["LapDat"]:
        await con.execute(
            "INSERT INTO install_readings (sensor_id, time, rho0, temp, moisture, rho_ref, source) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            ids[i["ma_cuc"]], _ts(i["thoi_diem"]), float(i["rho0_ohm_m"]), float(i["nhiet_do_c"]),
            dataset._num(i.get("do_am_pct")), dataset._num(i.get("rho_doi_chung_ohm_m")), src)
        counts["LapDat"] += 1
    for c in tables["KiemChung"]:
        await con.execute(
            """INSERT INTO field_checks (sensor_id, time, stress_true, rho, temp, moisture, rho_ref, source)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
            ids[c["ma_cuc"]], _ts(c["thoi_diem"]), float(c["ung_suat_that_mpa"]), float(c["rho_ohm_m"]),
            float(c["nhiet_do_c"]), dataset._num(c.get("do_am_pct")), dataset._num(c.get("rho_doi_chung_ohm_m")), src)
        counts["KiemChung"] += 1
    return counts


# ---------------------------------------------------------------- trang Nhập dữ liệu
class RowsIn(BaseModel):
    sheet: str
    rows: list[dict]
    context: str = ""          # mô tả bối cảnh thí nghiệm (lưu kèm)
    chat: list[dict] = []      # hội thoại với trợ lý (lưu kèm)


class AssistantIn(BaseModel):
    context: str = ""
    messages: list[dict]
    form: dict = {}


@router.get("/ai/assistant")
async def assistant_status(_=Depends(current_user)):
    return assistant.status()


@router.post("/ai/assistant")
async def assistant_chat(body: AssistantIn, _=Depends(admin_user)):
    if not body.messages or body.messages[-1].get("role") != "user":
        raise HTTPException(400, "Tin nhắn cuối phải là của người dùng")
    async with db.pool.acquire() as con:
        blocks = [dict(r) for r in await con.fetch(
            "SELECT code, mix, electrode_area_mm2, electrode_gap_mm, load_area_mm2, fc_mpa, is_reference FROM sensors ORDER BY code")]
    try:
        return await assistant.chat(body.context, body.messages, blocks, body.form)
    except Exception as e:  # model chưa chạy, sai khoá, trả JSON hỏng...
        log.warning("trợ lý lỗi: %s", e)
        raise HTTPException(502, f"Trợ lý AI chưa trả lời được ({assistant.status()['provider']}: {e})")


@router.post("/ai/rows")
async def save_rows(body: RowsIn, user=Depends(admin_user)):
    """Lưu các dòng nhập trên web (cùng cột với template). Lỗi ở bất kỳ dòng nào thì không lưu gì."""
    if body.sheet not in dataset.SHEETS:
        raise HTTPException(400, "Loại dữ liệu không hợp lệ")
    if not body.rows:
        raise HTTPException(400, "Chưa có dòng nào")
    errors: list[str] = []
    rows = [{**r, "_row": i} for i, r in enumerate(body.rows, start=1)]
    async with db.pool.acquire() as con:
        async with con.transaction():
            skip = {str(r.get("ma_cuc", "")).strip() for r in rows} if body.sheet == "Cuc" else set()
            tables = {k: [] for k in dataset.SHEETS}
            tables["Cuc"] = await _db_blocks(con, skip)
            tables[body.sheet] = tables[body.sheet] + rows if body.sheet == "Cuc" else rows
            dataset.check_tables(tables, errors)
            if errors:
                raise HTTPException(400, "; ".join(errors[:5]))
            if body.sheet == "EpBac":   # mỗi lần lưu trên web là một lần ép mới
                for r in tables["EpBac"]:
                    r["lan_ep"] = f"web-{datetime.now():%Y%m%d%H%M%S}-{r['lan_ep']}"
            counts = await _store(con, tables, "Nhập trên web", user["u"])
            if body.context.strip() or body.chat:
                sid = await con.fetchval("SELECT id FROM sensors WHERE code = $1", str(body.rows[0].get("ma_cuc", "")).strip())
                await con.execute(
                    "INSERT INTO experiment_notes (sheet, sensor_id, context, chat, n_rows, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
                    body.sheet, sid, body.context, json.dumps(body.chat, ensure_ascii=False), sum(counts.values()), user["u"])
    ingest.invalidate()
    return {"counts": counts}


SHEET_SQL = {
    "Cuc": ("""SELECT s.id, s.code AS ma_cuc, s.mix AS cap_phoi, s.batch AS me_duc, s.fc_mpa AS cuong_do_nen_mpa,
                      s.electrode_area_mm2 AS dien_tich_dien_cuc_mm2, s.electrode_gap_mm AS khoang_cach_dien_cuc_mm,
                      s.load_area_mm2 AS dien_tich_chiu_nen_mm2, s.is_reference AS la_cuc_doi_chung,
                      r.code AS ma_cuc_doi_chung, s.location AS vi_tri, s.created_at
               FROM sensors s LEFT JOIN sensors r ON r.id = s.reference_sensor_id {w} ORDER BY s.code""", "s.id"),
    "QuetNhiet": ("""SELECT t.id, s.code AS ma_cuc, t.t_from AS thoi_diem, t.temp AS nhiet_do_c, t.moisture AS do_am_pct,
                            t.rho AS rho_ohm_m, t.rho_std, t.n_samples AS so_mau, t.source, t.created_at
                     FROM calib_temp_steps t JOIN sensors s ON s.id = t.sensor_id {w} ORDER BY t.id DESC LIMIT 1000""", "s.id"),
    "EpBac": ("""SELECT st.id, s.code AS ma_cuc, r.id AS lan_ep, st.load_kn AS tai_kn, st.stress_mpa AS ung_suat_mpa,
                        st.rho AS rho_ohm_m, st.rho_std, st.temp AS nhiet_do_c, st.t_from AS thoi_diem, st.created_at
                 FROM calib_steps st JOIN calib_runs r ON r.id = st.run_id JOIN sensors s ON s.id = r.sensor_id {w}
                 ORDER BY st.id DESC LIMIT 1000""", "s.id"),
    "LapDat": ("""SELECT i.id, s.code AS ma_cuc, i.time AS thoi_diem, i.rho0 AS rho0_ohm_m, i.temp AS nhiet_do_c,
                         i.moisture AS do_am_pct, i.rho_ref AS rho_doi_chung_ohm_m, i.source, i.created_at
                  FROM install_readings i JOIN sensors s ON s.id = i.sensor_id {w} ORDER BY i.id DESC LIMIT 1000""", "s.id"),
    "KiemChung": ("""SELECT c.id, s.code AS ma_cuc, c.time AS thoi_diem, c.stress_true AS ung_suat_that_mpa, c.rho AS rho_ohm_m,
                            c.temp AS nhiet_do_c, c.rho_ref AS rho_doi_chung_ohm_m, c.stress_pred, c.source, c.created_at
                     FROM field_checks c JOIN sensors s ON s.id = c.sensor_id {w} ORDER BY c.id DESC LIMIT 1000""", "s.id"),
}
DELETE_SQL = {"QuetNhiet": "calib_temp_steps", "EpBac": "calib_steps", "LapDat": "install_readings", "KiemChung": "field_checks"}


@router.get("/ai/rows")
async def list_rows(sheet: str, sensor_id: int | None = None, _=Depends(current_user)):
    if sheet not in SHEET_SQL:
        raise HTTPException(400, "Loại dữ liệu không hợp lệ")
    sql, col = SHEET_SQL[sheet]
    async with db.pool.acquire() as con:
        rows = await con.fetch(sql.format(w=f"WHERE {col} = $1" if sensor_id else ""), *([sensor_id] if sensor_id else []))
        counts = {
            "QuetNhiet": await con.fetchval("SELECT count(*) FROM calib_temp_steps"),
            "EpBac": await con.fetchval("SELECT count(*) FROM calib_steps"),
            "LapDat": await con.fetchval("SELECT count(*) FROM install_readings"),
            "KiemChung": await con.fetchval("SELECT count(*) FROM field_checks"),
            "Cuc": await con.fetchval("SELECT count(*) FROM sensors"),
        }
    return {"rows": [_row(r) for r in rows], "counts": counts}


@router.delete("/ai/rows/{sheet}/{rid}")
async def delete_row(sheet: str, rid: int, _=Depends(admin_user)):
    table = DELETE_SQL.get(sheet)
    if not table:
        raise HTTPException(400, "Xoá cục ở trang Quản trị")
    async with db.pool.acquire() as con:
        await con.execute(f"DELETE FROM {table} WHERE id = $1", rid)
    return {"ok": True}


@router.get("/sensors/{sid}/now")
async def now_reading(sid: int, window_s: float = 10.0, _=Depends(current_user)):
    """Trung bình tín hiệu trực tiếp vài giây gần nhất của cục và cục đối chứng (để điền nhanh trên trang Nhập dữ liệu)."""
    async with db.pool.acquire() as con:
        s = await _sensor(con, sid)
    v = _live(sid, window_s)
    if not v:
        raise HTTPException(409, "Cục này chưa gửi tín hiệu (node offline hoặc chưa gán cục)")
    vr = _live(s["reference_sensor_id"], window_s) if s["reference_sensor_id"] else None
    win = ingest.window(sid, window_s)
    return {"rho": v["rho"], "rho_std": v["rho_std"], "temp": v["temp"], "rh": v["rh"], "n": v["n"],
            "rho_ref": vr["rho"] if vr else None, "stress": _nanmean([x[5] for x in win]),
            "time": v["t_to"].isoformat()}


def _date(v):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10]) if v else None
    except ValueError:
        return None


def _ts(v):
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(v))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# ---------------------------------------------------------------- thu thập tự động từ tín hiệu trực tiếp
class TempStepIn(BaseModel):
    sensor_id: int
    temp: float | None = None          # nhiệt độ trong cục đo bằng nhiệt kế riêng; trống = lấy từ node
    moisture: float | None = None
    window_s: float = Field(60.0, ge=5, le=600)


@router.post("/calib/temp-steps")
async def add_temp_step(body: TempStepIn, _=Depends(admin_user)):
    v = _live(body.sensor_id, body.window_s)
    if not v:
        raise HTTPException(409, "Chưa có tín hiệu trực tiếp từ cục này")
    T = body.temp if body.temp is not None else v["temp"]
    if T is None:
        raise HTTPException(400, "Node không gửi nhiệt độ: nhập nhiệt độ trong cục")
    async with db.pool.acquire() as con:
        r = await con.fetchrow(
            """INSERT INTO calib_temp_steps (sensor_id, temp, moisture, rho, rho_std, n_samples, t_from, t_to)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *""",
            body.sensor_id, T, body.moisture, v["rho"], v["rho_std"], v["n"], v["t_from"], v["t_to"])
    return _row(r)


@router.delete("/calib/temp-steps/{tid}")
async def delete_temp_step(tid: int, _=Depends(admin_user)):
    async with db.pool.acquire() as con:
        await con.execute("DELETE FROM calib_temp_steps WHERE id = $1", tid)
    return {"ok": True}


@router.get("/sensors/{sid}/ai")
async def ai_state(sid: int, _=Depends(current_user)):
    async with db.pool.acquire() as con:
        s = await _sensor(con, sid)
        temps = await con.fetch("SELECT * FROM calib_temp_steps WHERE sensor_id = $1 ORDER BY temp, id", sid)
        ins = await con.fetch("SELECT * FROM install_readings WHERE sensor_id = $1 ORDER BY id DESC LIMIT 5", sid)
        chk = await con.fetch("SELECT * FROM field_checks WHERE sensor_id = $1 ORDER BY id DESC LIMIT 50", sid)
        models = await con.fetch("SELECT * FROM calib_models WHERE sensor_id = $1 AND kind = 'hybrid' ORDER BY id DESC LIMIT 10", sid)
        drift = await con.fetchrow("SELECT * FROM drift_events WHERE sensor_id = $1 ORDER BY id DESC LIMIT 1", sid)
        ref = await con.fetchrow("SELECT id, code FROM sensors WHERE id = $1", s["reference_sensor_id"]) if s["reference_sensor_id"] else None
        refs = await con.fetch("SELECT id, code FROM sensors WHERE is_reference AND id <> $1 ORDER BY code", sid)
    return {"sensor": _row(s), "reference": _row(ref) if ref else None, "reference_options": [_row(r) for r in refs],
            "temp_steps": [_row(r) for r in temps], "install": [_row(r) for r in ins], "checks": [_row(r) for r in chk],
            "models": [_row(r) for r in models], "drift": _row(drift) if drift else None}


class RefIn(BaseModel):
    is_reference: bool = False
    reference_sensor_id: int | None = None
    batch: str | None = None
    fc_mpa: float | None = None


@router.patch("/sensors/{sid}/ai")
async def set_reference(sid: int, body: RefIn, _=Depends(admin_user)):
    async with db.pool.acquire() as con:
        await _sensor(con, sid)
        if body.reference_sensor_id == sid:
            raise HTTPException(400, "Cục không thể là đối chứng của chính nó")
        await con.execute(
            """UPDATE sensors SET is_reference = $2, reference_sensor_id = $3,
                 batch = coalesce($4, batch), fc_mpa = coalesce($5, fc_mpa) WHERE id = $1""",
            sid, body.is_reference, body.reference_sensor_id, body.batch, body.fc_mpa)
    ingest.invalidate()
    return {"ok": True}


class WindowIn(BaseModel):
    window_s: float = Field(300.0, ge=5, le=1800)
    moisture: float | None = None
    temp: float | None = None


@router.post("/sensors/{sid}/install-zero")
async def install_zero(sid: int, body: WindowIn, _=Depends(admin_user)):
    """Đo mốc lắp đặt (cục đã đặt vào công trình, CHƯA cho tải). Cập nhật luôn mô hình lai đang dùng."""
    async with db.pool.acquire() as con:
        s = await _sensor(con, sid)
    v = _live(sid, body.window_s)
    if not v:
        raise HTTPException(409, "Chưa có tín hiệu trực tiếp từ cục này")
    T = body.temp if body.temp is not None else v["temp"]
    if T is None:
        raise HTTPException(400, "Không có nhiệt độ: nhập nhiệt độ trong cục")
    rho_ref = None
    if s["reference_sensor_id"]:
        vr = _live(s["reference_sensor_id"], body.window_s)
        if not vr:
            raise HTTPException(409, "Cục đối chứng chưa gửi tín hiệu: bật node đối chứng trước khi đặt mốc")
        rho_ref = vr["rho"]
    async with db.pool.acquire() as con:
        r = await con.fetchrow(
            "INSERT INTO install_readings (sensor_id, time, rho0, temp, moisture, rho_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
            sid, v["t_to"], v["rho"], T, body.moisture, rho_ref)
        m = await con.fetchrow("SELECT * FROM calib_models WHERE sensor_id = $1 AND active AND kind = 'hybrid'", sid)
        if m:
            p = hybrid.HybridParams.from_json(_params(m))
            p.install = await _install_dict(con, s, r)
            await con.execute("UPDATE calib_models SET params = $2::jsonb WHERE id = $1", m["id"], json.dumps(p.to_json()))
    ingest.invalidate()
    return _row(r)


class CheckIn(BaseModel):
    stress_mpa: float | None = None
    load_kn: float | None = None
    window_s: float = Field(30.0, ge=2, le=600)


@router.post("/sensors/{sid}/field-checks")
async def add_field_check(sid: int, body: CheckIn, _=Depends(admin_user)):
    """Ghi một điểm kiểm chứng lúc biết chắc tải đang tác dụng."""
    async with db.pool.acquire() as con:
        s = await _sensor(con, sid)
    stress = body.stress_mpa if body.stress_mpa is not None else (
        body.load_kn * 1000.0 / s["load_area_mm2"] if body.load_kn is not None else None)
    if stress is None:
        raise HTTPException(400, "Nhập ứng suất (MPa) hoặc lực (kN)")
    v = _live(sid, body.window_s)
    if not v:
        raise HTTPException(409, "Chưa có tín hiệu trực tiếp từ cục này")
    vr = _live(s["reference_sensor_id"], body.window_s) if s["reference_sensor_id"] else None
    win = ingest.window(sid, body.window_s)
    pred = _nanmean([x[5] for x in win])
    async with db.pool.acquire() as con:
        r = await con.fetchrow(
            """INSERT INTO field_checks (sensor_id, time, stress_true, rho, temp, moisture, rho_ref, stress_pred)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *""",
            sid, v["t_to"], stress, v["rho"], v["temp"], None, vr["rho"] if vr else None, pred)
    return _row(r)


# ---------------------------------------------------------------- huấn luyện
def _params(m) -> dict:
    p = m["params"]
    return json.loads(p) if isinstance(p, str) else dict(p)


async def _install_dict(con, s, r) -> dict:
    d = {"rho0": r["rho0"], "T": r["temp"], "W": r["moisture"], "rho_ref": r["rho_ref"], "time": r["time"].isoformat()}
    if s["reference_sensor_id"]:
        rm = await con.fetchrow("SELECT params FROM calib_models WHERE sensor_id = $1 AND kind = 'hybrid' ORDER BY active DESC, id DESC LIMIT 1",
                                s["reference_sensor_id"])
        if rm:
            d["a_ref"] = hybrid.HybridParams.from_json(_params(rm)).a
    return d


async def _prior(con, mix: str) -> dict:
    st = await con.fetchval("SELECT stats FROM ai_priors WHERE mix = $1", mix.upper())
    fleet = (json.loads(st) if isinstance(st, str) else st) if st else None
    return hybrid.prior_for(mix, fleet)


@router.post("/sensors/{sid}/models/hybrid")
async def fit_hybrid(sid: int, run_id: int | None = None, _=Depends(admin_user)):
    """Huấn luyện mô hình lai cho cục từ dữ liệu quét nhiệt + mọi lần ép (hoặc chỉ run_id).
    Tạo phiên bản mới, chưa dùng cho tới khi admin duyệt."""
    async with db.pool.acquire() as con:
        s = await _sensor(con, sid)
        temps = await con.fetch("SELECT * FROM calib_temp_steps WHERE sensor_id = $1", sid)
        q = """SELECT st.*, r.id AS run FROM calib_steps st JOIN calib_runs r ON r.id = st.run_id
               WHERE r.sensor_id = $1""" + (" AND r.id = $2" if run_id else "") + " ORDER BY st.id"
        steps = await con.fetch(q, *([sid, run_id] if run_id else [sid]))
        prior = await _prior(con, s["mix"])
        ins = await con.fetchrow("SELECT * FROM install_readings WHERE sensor_id = $1 ORDER BY time DESC, id DESC LIMIT 1", sid)
        sweep = {"T": [t["temp"] for t in temps], "rho": [t["rho"] for t in temps]} if temps else None
        press = None
        if steps and not s["is_reference"]:
            # chu kỳ: tách khi tải quay về bậc nhỏ nhất sau khi đã tăng
            cyc, labels = {}, []
            smin = {}
            for st in steps:
                smin[st["run"]] = min(smin.get(st["run"], 1e9), st["stress_mpa"])
            for st in steps:
                c = cyc.setdefault(st["run"], [1, False])
                if st["stress_mpa"] <= smin[st["run"]] + 1e-9 and c[1]:
                    c[0] += 1; c[1] = False
                if st["stress_mpa"] > smin[st["run"]] + 1e-9:
                    c[1] = True
                labels.append(f"{st['run']}-{c[0]}")
            press = {"sigma": [st["stress_mpa"] for st in steps], "rho": [st["rho"] for st in steps],
                     "T": [st["temp"] if st["temp"] is not None else np.nan for st in steps], "cycle": labels}
        try:
            p = hybrid.fit_block(s["mix"], sweep, press, prior)
        except ValueError as e:
            raise HTTPException(400, str(e))
        if ins:
            p.install = await _install_dict(con, s, ins)
        met = p.metrics
        m = await con.fetchrow(
            """INSERT INTO calib_models (sensor_id, run_id, kind, k, rho0, rho0_ref, temp, moisture, r2, rmse_mpa, params)
               VALUES ($1,$2,'hybrid',$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *""",
            sid, run_id, p.kappa * p.rho20, p.rho20, p.rho20, p.Tc, p.Wc, met.get("r2"),
            met.get("cv_rmse_mpa") or met.get("rmse_mpa"), json.dumps(p.to_json()))
    return _row(m)


@router.post("/ai/fleet")
async def update_fleet(_=Depends(admin_user)):
    """Tính lại prior từng cấp phối từ các mô hình lai đang dùng (cần >= 5 cục để có hiệu lực)."""
    async with db.pool.acquire() as con:
        rows = await con.fetch("""SELECT s.mix, m.params FROM calib_models m JOIN sensors s ON s.id = m.sensor_id
                                  WHERE m.active AND m.kind = 'hybrid' AND NOT s.is_reference""")
        by_mix = {}
        for r in rows:
            by_mix.setdefault(r["mix"].upper(), []).append(hybrid.HybridParams.from_json(_params(r)))
        out = {}
        for mix, ps in by_mix.items():
            st = hybrid.fleet_stats(ps)
            out[mix] = st
            await con.execute(
                """INSERT INTO ai_priors (mix, stats, updated_at) VALUES ($1, $2::jsonb, now())
                   ON CONFLICT (mix) DO UPDATE SET stats = EXCLUDED.stats, updated_at = now()""", mix, json.dumps(st))
    return out


@router.get("/ai/evaluate")
async def evaluate(_=Depends(current_user)):
    """Sai số mô hình đang dùng trên các điểm kiểm chứng hiện trường, theo từng cục."""
    async with db.pool.acquire() as con:
        rows = await con.fetch("""SELECT s.id, s.code, m.params, m.kind FROM sensors s
                                  JOIN calib_models m ON m.sensor_id = s.id AND m.active AND m.kind = 'hybrid'""")
        out = []
        for r in rows:
            p = hybrid.HybridParams.from_json(_params(r))
            chk = await con.fetch("SELECT * FROM field_checks WHERE sensor_id = $1 ORDER BY time", r["id"])
            if not chk:
                out.append({"code": r["code"], "n": 0}); continue
            errs, inside = [], 0
            t0 = datetime.fromisoformat(p.install["time"]) if p.install and p.install.get("time") else None
            for c in chk:
                days = (c["time"] - t0).total_seconds() / 86400 if t0 else None
                pr = hybrid.predict(p, [c["rho"]], c["temp"], c["moisture"] if p.install and p.install.get("W") is not None else None,
                                    c["rho_ref"], days)
                errs.append(float(pr.stress[0]) - c["stress_true"]); inside += int(pr.lo[0] <= c["stress_true"] <= pr.hi[0])
            e = np.array(errs)
            out.append({"code": r["code"], "n": len(e), "rmse_mpa": float(np.sqrt(np.mean(e**2))),
                        "bias_mpa": float(e.mean()), "ci95_coverage": inside / len(e)})
    return out


# ---------------------------------------------------------------- kiểm tra trôi
async def check_drift(sid: int, days: int = 14) -> dict:
    async with db.pool.acquire() as con:
        s = await _sensor(con, sid)
        m = await con.fetchrow("SELECT * FROM calib_models WHERE sensor_id = $1 AND active AND kind = 'hybrid'", sid)
        if not m:
            return {"status": "no_model", "flags": []}
        p = hybrid.HybridParams.from_json(_params(m))
        since = datetime.now(timezone.utc) - timedelta(days=days)
        src = "samples_1m" if db.has_timescale else "samples"
        q = f"""SELECT date_trunc('day', time) AS d,
                       min(stress) AS smin, percentile_cont(0.5) WITHIN GROUP (ORDER BY stress) AS smed,
                       avg((rho_max - rho_min) / nullif(rho, 0)) AS noise
                FROM {src} WHERE sensor_id = $1 AND time >= $2 GROUP BY 1 ORDER BY 1"""
        if src == "samples":
            q = q.replace("avg((rho_max - rho_min) / nullif(rho, 0))", "stddev(rho) / nullif(avg(rho), 0)")
        try:
            rows = await con.fetch(q, sid, since)
        except Exception:
            rows = []
        ref_env = {}
        if s["reference_sensor_id"]:
            try:
                rr = await con.fetch(f"SELECT date_trunc('day', time) AS d, avg(rho) AS rho, avg(temp) AS temp FROM {src} "
                                     "WHERE sensor_id = $1 AND time >= $2 GROUP BY 1 ORDER BY 1", s["reference_sensor_id"], since)
                for r in rr:
                    if r["rho"] and r["temp"] is not None:
                        ref_env[r["d"]] = float(np.log(r["rho"]) - p.a * (r["temp"] - 20))
            except Exception:
                pass
        daily = [{"day": r["d"], "stress_min": r["smin"], "stress_med": r["smed"], "noise": r["noise"],
                  "ref_env": ref_env.get(r["d"])} for r in rows]
        rep = hybrid.drift_report(p, daily)
        await con.execute("INSERT INTO drift_events (sensor_id, status, flags) VALUES ($1,$2,$3::jsonb)",
                          sid, rep["status"], json.dumps(rep["flags"], ensure_ascii=False))
    return rep


@router.post("/sensors/{sid}/drift")
async def drift_now(sid: int, _=Depends(current_user)):
    return await check_drift(sid)


async def drift_loop(interval_s: float = 6 * 3600):
    """Chạy nền: kiểm tra trôi cho mọi cục có mô hình lai, 6 giờ một lần."""
    await asyncio.sleep(60)
    while True:
        try:
            async with db.pool.acquire() as con:
                ids = [r["sensor_id"] for r in await con.fetch(
                    "SELECT sensor_id FROM calib_models WHERE active AND kind = 'hybrid'")]
            for sid in ids:
                await check_drift(sid)
        except Exception as e:
            log.warning("Kiểm tra trôi lỗi: %s", e)
        await asyncio.sleep(interval_s)

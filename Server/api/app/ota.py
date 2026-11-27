"""Nạp firmware OTA qua server.

Luồng:
  1. Quản trị tải ảnh .bin (build/esp32s3-meter.bin của idf.py build) lên POST /api/firmware.
     Server đọc esp_app_desc_t trong ảnh để lấy phiên bản, tên dự án, chip, ngày build.
  2. POST /api/firmware/<id>/deploy {"devices": [...]}: với mỗi mạch online, tạo một token dùng riêng
     cho lần nạp đó rồi gửi lệnh (QoS 1, không retained):
       ssc/<id>/ota   {"job": "a1b2c3d4", "url": "/api/ota/<token>", "version": "ssc-1.1.0",
                       "size": 1201504, "sha256": "..."}
     url bắt đầu bằng "/" thì mạch ghép với địa chỉ máy chủ MQTT (http://<host>:8000). Đặt OTA_BASE_URL
     (vd https://ssc.example.com) để gửi địa chỉ đầy đủ.
  3. Mạch tải GET /api/ota/<token> (không cần đăng nhập, token chỉ dùng được khi lần nạp đang chạy),
     ghi vào phân vùng OTA còn lại, báo tiến độ:
       ssc/<id>/ota/state  {"job": "...", "state": "downloading|rebooting|error|rejected", "pct": 40, "msg": "..."}
  4. Mạch khởi động lại. Gói status đầu tiên mang "fw" = phiên bản mới thì lần nạp thành công; vẫn là bản cũ
     nghĩa là bootloader đã trả về bản cũ (rollback).

Firmware báo "ota": 1 trong gói status nếu biết nhận lệnh này (ssc-1.1.0 trở lên). Bản cũ hơn phải nạp
bằng cáp hoặc POST /update trên mạch một lần.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import struct
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel

from . import config, db
from .auth import admin_user, current_user
from .ingest import ingest

log = logging.getLogger("ssc.ota")
router = APIRouter(prefix="/api")

OTA_BASE_URL = os.getenv("OTA_BASE_URL", "").rstrip("/")
MAX_IMAGE = 0x300000            # phân vùng ota_0/ota_1 trong partitions.csv
ACTIVE = ("sent", "downloading", "rebooting")
CHIPS = {0: "esp32", 2: "esp32s2", 5: "esp32c3", 9: "esp32s3", 12: "esp32c2", 13: "esp32c6",
         16: "esp32h2", 18: "esp32p4"}


def _row(r):
    return {k: (v.isoformat() if isinstance(v, (datetime, date)) else v) for k, v in dict(r).items()}


def _cstr(b: bytes) -> str:
    return b.split(b"\0", 1)[0].decode("utf-8", "replace").strip()


def parse_image(data: bytes) -> dict:
    """Đọc phần đầu ảnh app ESP-IDF: esp_image_header_t (24 B) + segment header (8 B) + esp_app_desc_t."""
    if len(data) < 32 + 256:
        raise ValueError("File quá nhỏ, không phải ảnh firmware ESP32")
    if data[0] != 0xE9:
        raise ValueError("Không phải ảnh app ESP32 (byte đầu phải là 0xE9). Chọn file build/<tên dự án>.bin, "
                         "không chọn bootloader.bin, partition-table.bin hay file .elf")
    chip_id = struct.unpack_from("<H", data, 12)[0]
    magic = struct.unpack_from("<I", data, 32)[0]
    if magic != 0xABCD5432:
        raise ValueError("Ảnh không có esp_app_desc_t (không phải app ESP-IDF)")
    return {
        "version": _cstr(data[48:80]) or "?",
        "project": _cstr(data[80:112]),
        "built": f"{_cstr(data[128:144])} {_cstr(data[112:128])}".strip(),
        "idf_ver": _cstr(data[144:176]),
        "chip": CHIPS.get(chip_id, f"chip {chip_id}"),
    }


def _ota_json(v) -> dict | None:
    if v is None:
        return None
    o = json.loads(v) if isinstance(v, str) else dict(v)
    o.pop("token", None)
    return o


# ---------------------------------------------------------------- firmware
@router.get("/firmware")
async def list_firmware(_=Depends(current_user)):
    async with db.pool.acquire() as con:
        rows = await con.fetch(
            """SELECT id, version, project, idf_ver, built, chip, size, sha256, notes, uploaded_by, uploaded_at
               FROM firmware ORDER BY uploaded_at DESC""")
    return [_row(r) for r in rows]


@router.post("/firmware")
async def upload_firmware(file: UploadFile = File(...), notes: str = Form(""), user=Depends(admin_user)):
    data = await file.read(MAX_IMAGE + 1)
    if len(data) > MAX_IMAGE:
        raise HTTPException(413, f"Ảnh lớn hơn phân vùng OTA ({MAX_IMAGE // 1024} KB)")
    try:
        info = parse_image(data)
    except ValueError as e:
        raise HTTPException(422, str(e))
    sha = hashlib.sha256(data).hexdigest()
    async with db.pool.acquire() as con:
        old = await con.fetchval("SELECT id FROM firmware WHERE sha256 = $1", sha)
        if old:
            raise HTTPException(409, f"Ảnh này đã được tải lên rồi (firmware #{old})")
        fid = await con.fetchval(
            """INSERT INTO firmware (version, project, idf_ver, built, chip, size, sha256, notes, data, uploaded_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id""",
            info["version"], info["project"], info["idf_ver"], info["built"], info["chip"], len(data), sha,
            notes.strip()[:500], data, user["u"])
    log.info("Firmware #%s %s (%s, %d B) do %s tải lên", fid, info["version"], info["project"], len(data), user["u"])
    return {"id": fid, **info, "size": len(data), "sha256": sha}


@router.delete("/firmware/{fid}")
async def delete_firmware(fid: int, _=Depends(admin_user)):
    async with db.pool.acquire() as con:
        busy = await con.fetchval(
            "SELECT count(*) FROM devices WHERE ota->>'fw_id' = $1 AND ota->>'state' = ANY($2)", str(fid), list(ACTIVE))
        if busy:
            raise HTTPException(409, "Đang có mạch nạp bản này, đợi xong rồi xoá")
        await con.execute("DELETE FROM firmware WHERE id = $1", fid)
    return {"ok": True}


class DeployIn(BaseModel):
    devices: list[str]


@router.post("/firmware/{fid}/deploy")
async def deploy(fid: int, body: DeployIn, _=Depends(admin_user)):
    """Gửi lệnh nạp cho từng mạch. Trả về kết quả từng mạch: sent hoặc lý do bỏ qua."""
    if not ingest.connected:
        raise HTTPException(503, "Server chưa kết nối MQTT, không gửi được lệnh cho mạch")
    async with db.pool.acquire() as con:
        await expire(con)
        fw = await con.fetchrow("SELECT id, version, project, size, sha256 FROM firmware WHERE id = $1", fid)
        if not fw:
            raise HTTPException(404, "Không tìm thấy firmware")
        rows = await con.fetch("SELECT id, fw, last_seen, ota_ok, ota FROM devices WHERE paired AND id = ANY($1)",
                               body.devices)
        found = {r["id"]: r for r in rows}
        results = {}
        for did in body.devices:
            r = found.get(did)
            cur = _ota_json(r["ota"]) if r else None
            if not r:
                results[did] = "không có mạch này hoặc chưa ghép"
            elif not _online(r["last_seen"]):
                results[did] = "mạch đang offline"
            elif not r["ota_ok"]:
                results[did] = f"firmware {r['fw'] or '?'} chưa hỗ trợ OTA qua server, nạp bằng cáp một lần"
            elif cur and cur.get("state") in ACTIVE:
                results[did] = "mạch đang nạp dở"
            else:
                job, token = secrets.token_hex(4), secrets.token_urlsafe(24)
                ota = {"job": job, "token": token, "fw_id": str(fw["id"]), "version": fw["version"],
                       "from": r["fw"], "state": "sent", "pct": 0, "msg": ""}
                await con.execute(
                    "UPDATE devices SET ota = $2::jsonb || jsonb_build_object('at', now()) WHERE id = $1",
                    did, json.dumps(ota))
                path = f"/api/ota/{token}"
                ingest.publish_ota(did, {"job": job, "url": f"{OTA_BASE_URL}{path}" if OTA_BASE_URL else path,
                                         "version": fw["version"], "size": fw["size"], "sha256": fw["sha256"]})
                results[did] = "sent"
                log.info("OTA %s: gửi lệnh nạp %s (job %s)", did, fw["version"], job)
    return {"results": results}


@router.get("/ota/{token}", include_in_schema=False)
async def download(token: str):
    """Mạch tải ảnh firmware. Không cần đăng nhập: token ngẫu nhiên, chỉ dùng được khi lần nạp đang chạy."""
    async with db.pool.acquire() as con:
        r = await con.fetchrow(
            """SELECT d.id, f.data FROM devices d JOIN firmware f ON f.id::text = d.ota->>'fw_id'
               WHERE d.ota->>'token' = $1 AND d.ota->>'state' IN ('sent', 'downloading')
                 AND (d.ota->>'at')::timestamptz > now() - interval '1 hour'""", token)
        if not r:
            raise HTTPException(404, "Không có lần nạp nào với token này")
        await con.execute(
            """UPDATE devices SET ota = ota || jsonb_build_object('state', 'downloading', 'at', now())
               WHERE id = $1 AND ota->>'state' = 'sent'""", r["id"])
    log.info("OTA %s: đang tải %d B", r["id"], len(r["data"]))
    return Response(bytes(r["data"]), media_type="application/octet-stream")


# ---------------------------------------------------------------- hooks từ ingest và trang Thiết bị
def _online(last_seen) -> bool:
    return bool(last_seen) and (datetime.now(timezone.utc) - last_seen).total_seconds() < config.ONLINE_TIMEOUT_S


async def on_state(device_id: str, d: dict):
    """ssc/<id>/ota/state từ mạch."""
    state = str(d.get("state", ""))
    if state not in ("downloading", "rebooting", "error", "rejected"):
        return
    try:
        pct = max(0, min(100, int(d.get("pct", 0))))
    except (TypeError, ValueError):
        pct = 0
    msg = str(d.get("msg", ""))[:200]
    if state in ("error", "rejected"):
        state = "failed"
    async with db.pool.acquire() as con:
        await con.execute(
            """UPDATE devices SET ota = ota || jsonb_build_object('state', $3::text, 'pct', $4::int, 'msg', $5::text,
                                                                   'at', now())
               WHERE id = $1 AND ota->>'job' = $2 AND ota->>'state' = ANY($6)""",
            device_id, str(d.get("job", "")), state, pct, msg, list(ACTIVE))
    if state == "failed":
        log.warning("OTA %s thất bại: %s", device_id, msg)


async def on_status(device_id: str, fw: str):
    """Gói status sau khi mạch khởi động lại: đúng phiên bản mới = xong, vẫn bản cũ = bị rollback."""
    async with db.pool.acquire() as con:
        res = await con.execute(
            """UPDATE devices SET ota = ota || jsonb_build_object(
                   'state', CASE WHEN $2 = ota->>'version' THEN 'ok' ELSE 'failed' END,
                   'msg', CASE WHEN $2 = ota->>'version' THEN '' ELSE
                          'Mạch khởi động lại vẫn chạy ' || $2 || ': bản mới bị trả về bản cũ (rollback)' END,
                   'pct', 100, 'at', now())
               WHERE id = $1 AND ota->>'state' = 'rebooting'
                 AND (ota->>'at')::timestamptz < now() - interval '2 seconds'""", device_id, fw)
    if res.endswith(" 1"):
        log.info("OTA %s: mạch đã chạy %s", device_id, fw)


async def expire(con):
    """Lần nạp không còn phản hồi thì đánh dấu thất bại để có thể nạp lại."""
    await con.execute(
        """UPDATE devices SET ota = ota || jsonb_build_object('state', 'failed', 'at', now(), 'msg',
               CASE WHEN ota->>'state' = 'rebooting' THEN 'Mạch không kết nối lại sau khi nạp'
                    ELSE 'Quá thời gian, mạch không phản hồi' END)
           WHERE ota->>'state' = ANY($1) AND (ota->>'at')::timestamptz < now() - CASE
               WHEN ota->>'state' = 'downloading' THEN interval '10 minutes' ELSE interval '3 minutes' END""",
        list(ACTIVE))


def device_ota(v) -> dict | None:
    return _ota_json(v)

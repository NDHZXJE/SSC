"""MQTT ingest: node packets -> computed Rs, rho, stress -> live buffer + samples table.

Topics (device id = e.g. ssc-a1b2c3):
  ssc/<id>/data    node -> server, 1 packet per second:
                   {"seq": 12, "t0": 1764150000000, "dt_ms": 10,
                    "us": [..100 floats, volts..], "up": [..] or 16.02,
                    "temp": 28.4, "rh": 61.0}
  ssc/<id>/status  node -> server (retained, LWT): {"online": true, "fw": "0.1.0", "ip": "...", "rssi": -58}
  ssc/<id>/config  server -> node (retained): {"rate_sps": 100, "pga": 1, ...}
  ssc/<id>/pair    server -> node (retained): {"paired": true} sau khi quản trị nhập đúng mã 6 số.
                   Node chưa ghép gửi thêm "pair": "123456" trong gói status và hiện mã đó cho người dùng.
  ssc/<id>/ota     server -> node: lệnh nạp firmware (xem ota.py). Node báo "ota": 1 trong status nếu hỗ trợ.
  ssc/<id>/ota/state node -> server: tiến độ nạp {"job", "state", "pct", "msg"}
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections import deque
from datetime import datetime, timezone

import numpy as np
import paho.mqtt.client as mqtt

from . import config, db
from . import hybrid
from .model import ActiveModel, rho_from_rs, rs_from_voltages

log = logging.getLogger("ssc.ingest")
PAIR_RE = re.compile(r"^\d{6}$")
COLUMNS = ["time", "sensor_id", "us", "up", "rs", "rho", "stress", "temp", "rh", "stress_lo", "stress_hi"]


class DeviceCtx:
    __slots__ = ("sensor_id", "rr", "area", "gap", "model", "hybrid", "ref_id", "t_install")

    def __init__(self, sensor_id, rr, area, gap, model, hyb=None, ref_id=None, t_install=None):
        self.sensor_id, self.rr, self.area, self.gap, self.model = sensor_id, rr, area, gap, model
        self.hybrid, self.ref_id, self.t_install = hyb, ref_id, t_install  # mô hình AI lai (hybrid.py)


class Ingest:
    def __init__(self):
        self.loop: asyncio.AbstractEventLoop | None = None
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=10000)
        self.client: mqtt.Client | None = None
        self.ctx: dict[str, DeviceCtx | None] = {}
        self.ctx_time = 0.0
        self.pending: list[tuple] = []
        self.seen: dict[str, dict] = {}
        self.live: dict[int, deque] = {}
        self.last_rho: dict[int, tuple[float, float]] = {}   # sensor_id -> (giờ máy, rho trung bình gói gần nhất)
        self.flags: dict[int, str] = {}                        # cờ của mô hình lai theo cục
        self.connected = False
        self.stats = {"packets": 0, "samples": 0, "errors": 0}
        self.tasks: list[asyncio.Task] = []

    # ---------- lifecycle ----------
    async def start(self):
        self.loop = asyncio.get_running_loop()
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"ssc-server-{int(time.time())}")
        if config.MQTT_USER:
            c.username_pw_set(config.MQTT_USER, config.MQTT_PASS)
        c.on_connect = self._on_connect
        c.on_disconnect = self._on_disconnect
        c.on_message = self._on_message
        c.reconnect_delay_set(1, 30)
        c.connect_async(config.MQTT_HOST, config.MQTT_PORT, keepalive=30)
        c.loop_start()
        self.client = c
        self.tasks = [asyncio.create_task(self._worker()), asyncio.create_task(self._flusher())]

    async def stop(self):
        for t in self.tasks:
            t.cancel()
        if self.client:
            self.client.loop_stop()
            self.client.disconnect()
        await self._flush()

    def invalidate(self):
        self.ctx_time = 0

    def publish_config(self, device_id: str, cfg: dict):
        if self.client:
            self.client.publish(f"ssc/{device_id}/config", json.dumps(cfg), qos=1, retain=True)

    def publish_paired(self, device_id: str, paired: bool):
        """Báo cho node biết đã ghép (retained). Bỏ ghép thì xoá tin retained để node hiện lại mã."""
        if self.client:
            payload = json.dumps({"paired": True}) if paired else b""
            self.client.publish(f"ssc/{device_id}/pair", payload, qos=1, retain=True)

    def publish_ota(self, device_id: str, cmd: dict):
        """Lệnh nạp firmware: không retained, để mạch khởi động lại không nhận lại lệnh cũ."""
        if self.client:
            self.client.publish(f"ssc/{device_id}/ota", json.dumps(cmd), qos=1, retain=False)

    # ---------- paho callbacks (network thread) ----------
    def _on_connect(self, client, userdata, flags, reason, props):
        self.connected = True
        client.subscribe([("ssc/+/data", 0), ("ssc/+/status", 1), ("ssc/+/ota/state", 1)])
        log.info("MQTT đã kết nối %s:%s", config.MQTT_HOST, config.MQTT_PORT)

    def _on_disconnect(self, client, userdata, flags, reason, props):
        self.connected = False
        log.warning("MQTT mất kết nối: %s", reason)

    def _on_message(self, client, userdata, msg):
        try:
            self.loop.call_soon_threadsafe(self.queue.put_nowait, (msg.topic, msg.payload))
        except Exception:
            self.stats["errors"] += 1

    # ---------- processing ----------
    async def _load_ctx(self):
        async with db.pool.acquire() as con:
            rows = await con.fetch(
                """SELECT d.id, d.rr_ohm, s.id AS sensor_id, s.electrode_area_mm2, s.electrode_gap_mm,
                          s.mix, s.moisture_pct, s.rho0_ref AS s_rho0_ref,
                          s.reference_sensor_id, m.kind, m.k, m.rho0, m.rho0_ref, m.params
                   FROM devices d
                   LEFT JOIN sensors s ON s.id = d.sensor_id
                   LEFT JOIN calib_models m ON m.sensor_id = s.id AND m.active"""
            )
        ctx = {}
        for r in rows:
            if r["sensor_id"] is None:
                ctx[r["id"]] = None
                continue
            model, hyb, t_ins = None, None, None
            if r["kind"] == "hybrid" and r["params"]:
                try:
                    pj = json.loads(r["params"]) if isinstance(r["params"], str) else dict(r["params"])
                    hyb = hybrid.HybridParams.from_json(pj)
                    if hyb.install and hyb.install.get("time"):
                        t_ins = datetime.fromisoformat(hyb.install["time"]).timestamp()
                except Exception as e:
                    log.warning("Tham số mô hình lai của cục %s lỗi: %s", r["sensor_id"], e)
            elif r["k"] is not None and r["rho0_ref"]:
                model = ActiveModel(r["kind"], r["k"], r["rho0_ref"], r["rho0"] or r["rho0_ref"],
                                    r["mix"], r["moisture_pct"])
            ctx[r["id"]] = DeviceCtx(r["sensor_id"], r["rr_ohm"], r["electrode_area_mm2"],
                                     r["electrode_gap_mm"], model, hyb, r["reference_sensor_id"], t_ins)
        self.ctx = ctx
        self.ctx_time = time.monotonic()

    async def _get_ctx(self, device_id: str) -> DeviceCtx | None:
        if time.monotonic() - self.ctx_time > 10:
            await self._load_ctx()
        if device_id not in self.ctx:
            async with db.pool.acquire() as con:
                await con.execute("INSERT INTO devices (id) VALUES ($1) ON CONFLICT DO NOTHING", device_id)
            log.info("Thiết bị mới tự đăng ký: %s", device_id)
            await self._load_ctx()
        return self.ctx.get(device_id)

    async def _worker(self):
        while True:
            topic, payload = await self.queue.get()
            try:
                parts = topic.split("/")
                device_id, kind = parts[1], parts[2]
                data = json.loads(payload) if payload else {}
                if kind == "status":
                    self._mark_seen(device_id, data)
                    if data.get("online") is not False and data.get("fw"):
                        from . import ota
                        await ota.on_status(device_id, str(data["fw"]))
                elif kind == "data":
                    await self._handle_data(device_id, data)
                elif kind == "ota" and len(parts) == 4 and parts[3] == "state":
                    from . import ota
                    await ota.on_state(device_id, data)
            except Exception as e:
                self.stats["errors"] += 1
                log.warning("Gói lỗi trên %s: %s", topic, e)

    def _mark_seen(self, device_id: str, status: dict | None = None):
        s = self.seen.setdefault(device_id, {})
        if status and status.get("online") is False:
            s["offline"] = True
            return
        s["t"] = datetime.now(timezone.utc)
        s.pop("offline", None)
        if status:
            for k in ("fw", "ip", "rssi"):
                if k in status:
                    s[k] = status[k]
            if "fw" in status:   # mỗi bản firmware tự khai báo có nhận lệnh OTA qua server hay không
                s["ota_ok"] = bool(status.get("ota"))
            code = str(status.get("pair", "")).strip()
            if PAIR_RE.match(code):
                s["pair"] = code

    async def _handle_data(self, device_id: str, d: dict):
        self._mark_seen(device_id)
        ctx = await self._get_ctx(device_id)
        self.stats["packets"] += 1
        if ctx is None:
            return  # chưa gán cục: chỉ cập nhật trạng thái online
        us = np.asarray(d["us"], dtype=float)
        n = len(us)
        up = d.get("up")
        up = np.full(n, float(up)) if np.isscalar(up) else np.asarray(up, dtype=float)
        dt = float(d.get("dt_ms", 10))
        t0 = float(d.get("t0", time.time() * 1000))
        temp = d.get("temp")
        rh = d.get("rh")
        rs = rs_from_voltages(us, up, ctx.rr)
        rho = rho_from_rs(rs, ctx.area, ctx.gap)
        lo = hi = np.full(n, np.nan)
        rho_mean = float(np.nanmean(rho)) if np.isfinite(rho).any() else None
        if rho_mean is not None:
            self.last_rho[ctx.sensor_id] = (time.time(), rho_mean)
        if ctx.hybrid is not None:
            ref = self.last_rho.get(ctx.ref_id) if ctx.ref_id else None
            rho_ref = ref[1] if ref and time.time() - ref[0] < 5 else None
            days = (time.time() - ctx.t_install) / 86400 if ctx.t_install else None
            try:
                pr = hybrid.predict(ctx.hybrid, rho, temp if temp is not None else None, None, rho_ref, days)
                stress, lo, hi = pr.stress, pr.lo, pr.hi
                self.flags[ctx.sensor_id] = pr.flag if (rho_ref is not None or not ctx.ref_id) else "no_reference"
            except Exception as e:
                stress = np.full(n, np.nan)
                self.flags[ctx.sensor_id] = "error"
                log.warning("Mô hình lai lỗi ở cục %s: %s", ctx.sensor_id, e)
        else:
            stress = ctx.model.stress(rho, temp) if ctx.model else np.full(n, np.nan)
        times_ms = t0 + dt * np.arange(n)
        buf = self.live.setdefault(ctx.sensor_id, deque(maxlen=config.LIVE_BUFFER_S * 100))
        for i in range(n):
            ts = datetime.fromtimestamp(times_ms[i] / 1000, tz=timezone.utc)
            rec = (ts, ctx.sensor_id, _f(us[i]), _f(up[i]), _f(rs[i]), _f(rho[i]), _f(stress[i]), _f(temp), _f(rh),
                   _f(lo[i]), _f(hi[i]))
            self.pending.append(rec)
            buf.append((times_ms[i], *rec[2:]))
        self.stats["samples"] += n

    async def _flusher(self):
        while True:
            await asyncio.sleep(1.0)
            try:
                await self._flush()
            except Exception as e:
                self.stats["errors"] += 1
                log.error("Ghi DB lỗi: %s", e)

    async def _flush(self):
        if self.pending:
            batch, self.pending = self.pending, []
            async with db.pool.acquire() as con:
                await con.copy_records_to_table("samples", records=batch, columns=COLUMNS)
        if self.seen:
            rows = [(k, v.get("t"), v.get("fw"), v.get("ip"), v.get("rssi"), v.get("pair"), v.get("ota_ok"))
                    for k, v in self.seen.items() if v.get("t")]
            async with db.pool.acquire() as con:
                await con.executemany(
                    """INSERT INTO devices (id, last_seen, fw, ip, rssi, pair_code, ota_ok)
                       VALUES ($1, $2, coalesce($3, ''), coalesce($4, ''), $5, $6, coalesce($7, false))
                       ON CONFLICT (id) DO UPDATE SET last_seen = EXCLUDED.last_seen,
                         pair_code = CASE WHEN $6 IS NULL OR devices.paired THEN devices.pair_code ELSE EXCLUDED.pair_code END,
                         fw = CASE WHEN $3 IS NULL THEN devices.fw ELSE EXCLUDED.fw END,
                         ip = CASE WHEN $4 IS NULL THEN devices.ip ELSE EXCLUDED.ip END,
                         rssi = coalesce(EXCLUDED.rssi, devices.rssi),
                         ota_ok = coalesce($7, devices.ota_ok)""",
                    rows,
                )
            offline = [k for k, v in self.seen.items() if v.get("offline")]
            if offline:
                async with db.pool.acquire() as con:
                    await con.execute("UPDATE devices SET last_seen = NULL WHERE id = ANY($1)", offline)
            self.seen = {}

    # ---------- reads for the API ----------
    def live_since(self, sensor_id: int, since_ms: float, max_points: int = 2000) -> list:
        buf = self.live.get(sensor_id)
        if not buf:
            return []
        out = [r for r in buf if r[0] > since_ms]
        if len(out) > max_points:
            step = len(out) // max_points + 1
            out = out[::step]
        return out

    def window(self, sensor_id: int, seconds: float) -> list:
        buf = self.live.get(sensor_id)
        if not buf:
            return []
        cut = time.time() * 1000 - seconds * 1000
        return [r for r in buf if r[0] >= cut]


def _f(x):
    if x is None:
        return None
    x = float(x)
    return None if np.isnan(x) or np.isinf(x) else x


ingest = Ingest()

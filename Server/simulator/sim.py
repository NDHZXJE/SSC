"""Giả lập node SSC: gửi 100 mẫu/giây qua MQTT giống firmware thật.

Mỗi giây 1 gói JSON lên ssc/<id>/data. Tải nén chạy theo chu kỳ (0 -> max -> 0)
để thử biểu đồ và trang hiệu chuẩn. Mô hình vật liệu theo cấp phối F2:
rho0 ~ 12 Ω·m, K = -0.015*rho0 + 0.20 (Ω·m/MPa).

Ghép mạch: khi chưa ghép, mỗi node in ra mã 6 số và gửi kèm trong gói status ("pair").
Nhập mã đó ở trang Thiết bị → Thêm mạch đọc. Server báo lại qua ssc/<id>/pair.

Chạy:  python sim.py --host localhost --devices 3
"""
import argparse
import json
import math
import random
import threading
import time

import paho.mqtt.client as mqtt

RR = 820.0          # Ω, điện trở tham chiếu
UP = 16.0           # V, nguồn
AREA_MM2 = 2000.0   # A
GAP_MM = 30.0       # L
LOAD_AREA = 2500.0  # mm²


def current_load(t: float, period_s: float, max_kn: float, load_file: str | None) -> float:
    if load_file:  # giả lập máy nén: tải đọc từ file (kN), sửa file để đổi bậc tải
        try:
            with open(load_file) as f:
                return float(f.read().strip() or 0)
        except (OSError, ValueError):
            return 0.0
    return max_kn * 0.5 * (1 - math.cos(2 * math.pi * t / period_s))  # 0..max


def run_device(idx: int, host: str, port: int, period_s: float, max_kn: float, load_file: str | None):
    dev = f"ssc-sim{idx:02d}"
    rho0 = 10 + 2 * idx + random.uniform(-0.5, 0.5)
    k = -0.015 * rho0 + 0.20
    code = f"{random.randint(0, 999999):06d}"   # mã ghép, mỗi lần khởi động một mã mới
    status = {"online": True, "fw": "sim-0.2", "ip": "127.0.0.1", "rssi": -55}

    def send_status(paired: bool):
        st = dict(status) if paired else {**status, "pair": code}
        c.publish(f"ssc/{dev}/status", json.dumps(st), qos=1, retain=True)
        print(f"{dev}: đã ghép" if paired else f"{dev}: chưa ghép, mã ghép {code}", flush=True)

    def on_connect(client, userdata, flags, reason, props):
        client.subscribe(f"ssc/{dev}/pair", qos=1)
        send_status(False)

    def on_message(client, userdata, msg):
        try:
            paired = bool(msg.payload) and json.loads(msg.payload).get("paired") is True
        except ValueError:
            paired = False
        send_status(paired)

    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=dev)
    c.on_connect = on_connect
    c.on_message = on_message
    c.will_set(f"ssc/{dev}/status", json.dumps({"online": False}), qos=1, retain=True)
    c.connect(host, port, 30)
    c.loop_start()
    seq = 0
    t_next = time.time()
    while True:
        t0 = int(t_next * 1000)
        us = []
        temp = 28 + 2 * math.sin(t_next / 600)
        file_load = current_load(t_next, period_s, max_kn, load_file) if load_file else None
        for i in range(100):
            t = t_next + i * 0.01
            load_kn = file_load if load_file else current_load(t, period_s, max_kn, None)
            sigma = load_kn * 1000 / LOAD_AREA
            rho = rho0 * math.exp(-0.002 * (temp - 20)) + k * sigma + random.gauss(0, 0.01)
            rs = rho * (GAP_MM * 1e-3) / (AREA_MM2 * 1e-6)
            us.append(round(UP * rs / (rs + RR) + random.gauss(0, 0.0005), 6))
        pkt = {"seq": seq, "t0": t0, "dt_ms": 10, "us": us, "up": UP, "temp": round(temp, 2), "rh": 60.0}
        c.publish(f"ssc/{dev}/data", json.dumps(pkt), qos=0)
        seq += 1
        t_next += 1.0
        time.sleep(max(0.0, t_next - time.time()))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--devices", type=int, default=2)
    ap.add_argument("--period", type=float, default=60, help="chu kỳ tải (giây)")
    ap.add_argument("--max-kn", type=float, default=40, help="tải lớn nhất (kN)")
    ap.add_argument("--load-file", help="file chứa tải hiện tại (kN) để thử trang hiệu chuẩn")
    a = ap.parse_args()
    for i in range(1, a.devices + 1):
        threading.Thread(target=run_device, args=(i, a.host, a.port, a.period, a.max_kn, a.load_file), daemon=True).start()
    print(f"Đang gửi {a.devices} thiết bị giả lập tới {a.host}:{a.port}. Ctrl+C để dừng.")
    while True:
        time.sleep(1)

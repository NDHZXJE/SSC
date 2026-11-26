"""Bộ dữ liệu giả lập cho bê tông tự cảm biến (SSC) cấp phối F2.

Mô hình "sự thật" dùng để thử thuật toán, dựa trên Measurement 281 (2026):
  rho(t) = rho0_ref * A(t) * exp(a*(T-20) + b*W) * (1 + kappa(T,W)*sigma*(1 + q*sigma)) + nhiễu
  a ~ 1.2*alpha(Eq.12) * (1 + 30% lệch riêng từng cục)
  b ~ 0.9*beta(Eq.13)  * (1 + 20% lệch riêng)
  kappa = kappa0 * (1 + gT*(T-20) + gW*W)   (|K| giảm khi nóng, tăng khi ẩm, như Fig. 8-10)
  A(t)  = 1 + d*ln((t + 60)/60)              (già hóa / thủy hóa tiếp)
Mọi tham số là giả định để thử ý tưởng, KHÔNG phải số đo thật.
"""
from __future__ import annotations
import numpy as np

G_T, G_W = -0.0018, 0.075          # kappa thay đổi theo T (1/°C) và W (1/%)


def alpha_eq(r):
    ln = np.log(r); return -0.001 * ln**2 + 0.006 * ln - 0.01


def beta_eq(r):
    ln = np.log(r); return -0.0115 * ln**2 + 0.03 * ln + 0.074


class Block:
    def __init__(self, rng, batch=None):
        self.rho0_ref = rng.normal(11.0, 0.6) if batch is None else batch.rho0_ref * rng.normal(1, 0.03)
        spread_a = 0.3 if batch is None else 0.1
        ea = rng.normal(0, spread_a) if batch is None else batch._ea + rng.normal(0, spread_a)
        self._ea = ea
        self.a = 1.2 * alpha_eq(self.rho0_ref) * (1 + ea)
        self.b = 0.9 * beta_eq(self.rho0_ref) * (1 + rng.normal(0, 0.2 if batch is None else 0.05))
        self.kappa0 = rng.normal(-0.0034, 0.0006)
        self.q = rng.normal(-0.012, 0.006)
        self.d = rng.normal(0.03, 0.015) if batch is None else batch.d + rng.normal(0, 0.005)
        self.noise = 0.0005                      # nhiễu tương đối (trung bình 1 s)

    def rho(self, sigma, T, W, t_days, rng):
        A = 1 + self.d * np.log((np.asarray(t_days, float) + 60.0) / 60.0)   # t = ngày kể từ lắp đặt; ép mẫu ở t = -30
        kap = self.kappa0 * (1 + G_T * (T - 20) + G_W * W)
        base = self.rho0_ref * A * np.exp(self.a * (T - 20) + self.b * W)
        r = base * (1 + kap * sigma * (1 + self.q * sigma))
        return r * (1 + rng.normal(0, self.noise, np.shape(r)))


def lab_press(block, rng, T=25.0, W=0.0, step=2.0, smax=12.0, cycles=3, age_days=-30):
    """Hiệu chuẩn trên máy nén: các bậc 0->smax->0, mỗi bậc lấy trung bình 30 s."""
    up = np.arange(0, smax + 1e-9, step); seq = np.concatenate([up, up[-2::-1]])
    rows = []
    for c in range(cycles):
        for s in seq:
            Tm = T + rng.normal(0, 0.3)
            rows.append((c, s, Tm, block.rho(s, Tm, W, age_days, rng)))
    return np.array(rows)            # cycle, sigma, T, rho


def lab_temp_sweep(block, rng, temps=(15, 25, 35, 45), W=0.0, age_days=-30):
    """Quét nhiệt không tải trong tủ nhiệt: rho0 ở vài nhiệt độ."""
    return np.array([(T, block.rho(0.0, T, W, age_days, rng)) for T in temps])


def field(rng, days=60, dt_min=10):
    """Môi trường hiện trường chung cho một vị trí: nhiệt không khí, nhiệt trong cục, độ ẩm, tải."""
    n = int(days * 24 * 60 / dt_min); t = np.arange(n) * dt_min / 1440.0
    weather = np.cumsum(rng.normal(0, 0.15, n)); weather -= np.linspace(0, weather[-1], n)
    T_air = 30 + 5 * np.sin(2 * np.pi * (t - 0.375)) + np.clip(weather, -4, 4)
    T_in = np.empty(n); T_in[0] = T_air[0]; k = dt_min / 180.0   # trễ nhiệt ~3 h
    for i in range(1, n):
        T_in[i] = T_in[i - 1] + k * (T_air[i] + 2.0 * max(0, np.sin(2 * np.pi * (t[i] - 0.25))) - T_in[i - 1])
    W = np.empty(n); W[0] = 1.0; rain = rng.random(n) < dt_min / (7 * 1440)
    for i in range(1, n):
        W[i] = W[i - 1] + (0.6 - W[i - 1]) * dt_min / (7 * 1440) + (rng.uniform(0.1, 0.4) if rain[i] else 0)
    RH = np.clip(65 + 25 * np.convolve(rain.astype(float), np.ones(144), 'same') - 8 * np.sin(2 * np.pi * (t - 0.375)), 30, 100)
    sigma = np.clip(t / 0.5, 0, 1) * 3.0                      # tải thường xuyên 3 MPa, lắp trong 12 h đầu
    live = np.zeros(n); i = int(1 * 1440 / dt_min)
    while i < n:
        dur = int(rng.uniform(2, 12) * 60 / dt_min); live[i:i + dur] = rng.uniform(0.5, 5.0)
        i += dur + int(rng.uniform(4, 30) * 60 / dt_min)
    sigma = sigma + live * (t > 1)
    return dict(t=t, T_air=T_air + rng.normal(0, 0.3, n), T_in=T_in, W=W, RH=RH, sigma=sigma)

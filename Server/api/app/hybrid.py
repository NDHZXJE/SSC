"""Mô hình AI lai (vật lý + dữ liệu) để hiệu chuẩn và dự đoán ứng suất cho từng cục SSC.

Khung vật lý theo Nguyen M.H. et al., Measurement 281 (2026) 121975, viết ở dạng tương đối:

    rho = rho0(T, W, t) * (1 + x),   x = kappa*s + c2*s^2 + kT*s*(T - Tc) + kW*s*(W - Wc)

    rho0(T, W, t): nền không tải. Lấy theo cục đối chứng nếu có, nếu không thì theo mốc lúc lắp
                   đặt nhân exp(a*(T - T_lắp) + b*(W - W_lắp)).
    kappa: độ nhạy tương đối (1/MPa), c2: độ cong, kT/kW: kappa đổi theo nhiệt / ẩm.

Mỗi cục học các tham số riêng từ: quét nhiệt không tải (a, rho0 ở 20 °C) và ép theo bậc (kappa, c2, kT).
Tham số được ước lượng theo kiểu Bayes với "prior" là trung bình của các cục cùng cấp phối, nên cục ít
dữ liệu vẫn có kết quả hợp lý và mỗi dự đoán có khoảng tin cậy 95%.

Chỉ dùng numpy để chạy được trong ingest (100 mẫu/giây) và trong Jupyter.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict

import numpy as np

VERSION = "hybrid-1"
T_REF = 20.0

# Prior mặc định theo cấp phối khi chưa đủ 5 cục đã hiệu chuẩn. (trung bình, độ lệch chuẩn)
# kappa: K/rho0 ~ -0.037/10.8 theo Fig. 8 của bài báo. kT, kW lấy từ xu hướng Fig. 8-10.
DEFAULT_PRIORS = {
    "F2": {"kappa": (-0.0034, 0.0010), "c2": (4e-5, 6e-5), "gT": (-0.0018, 0.0012), "gW": (0.075, 0.04),
           "a_rel_sd": 0.35, "rho20": (11.0, 2.0)},
    "F1P1": {"kappa": (-0.0320, 0.0150), "c2": (0.0, 4e-4), "gT": (-0.0060, 0.0040), "gW": (0.013, 0.02),
             "a_rel_sd": 0.40, "rho20": (50.0, 25.0)},
}
GENERIC_PRIOR = {"kappa": (-0.005, 0.02), "c2": (0.0, 5e-4), "gT": (-0.002, 0.003), "gW": (0.05, 0.05),
                 "a_rel_sd": 0.5, "rho20": (20.0, 20.0)}


def alpha_eq(rho20: float) -> float:
    ln = math.log(max(rho20, 1e-3))
    return -0.001 * ln**2 + 0.006 * ln - 0.01          # Eq. 12


def beta_eq(rho20: float) -> float:
    ln = math.log(max(rho20, 1e-3))
    return -0.0115 * ln**2 + 0.03 * ln + 0.074          # Eq. 13


def prior_for(mix: str | None, fleet: dict | None = None) -> dict:
    p = dict(DEFAULT_PRIORS.get((mix or "").upper(), GENERIC_PRIOR))
    if fleet and fleet.get("n", 0) >= 5:                # đủ cục thật: dùng thống kê của đàn
        for k in ("kappa", "c2", "gT"):
            if k in fleet:
                p[k] = tuple(fleet[k])
    return p


# ---------------------------------------------------------------- Bayes tuyến tính
def _bayes_linreg(X, y, m0, s0, noise_sd=None, iters=3):
    """Hồi quy tuyến tính với prior Gauss độc lập. Trả về (trung bình, hiệp phương sai, sd nhiễu)."""
    X = np.asarray(X, float); y = np.asarray(y, float)
    m0 = np.asarray(m0, float); P0 = np.diag(1.0 / np.square(np.asarray(s0, float)))
    sd = noise_sd or max(float(np.std(y)) * 0.1, 1e-6)
    for _ in range(iters):
        P = P0 + X.T @ X / sd**2
        cov = np.linalg.inv(P)
        mean = cov @ (P0 @ m0 + X.T @ y / sd**2)
        if noise_sd:
            break
        r = y - X @ mean
        dof = max(len(y) - X.shape[1], 1)
        sd = max(float(np.sqrt(r @ r / dof)), 1e-6)
    return mean, cov, sd


# ---------------------------------------------------------------- tham số của một cục
@dataclass
class HybridParams:
    mix: str = "F2"
    a: float = 0.0               # hệ số nhiệt của ln(rho0), 1/°C
    a_sd: float = 0.0
    b: float = 0.0               # hệ số ẩm của ln(rho0), 1/%
    rho20: float = 0.0           # rho0 ở 20 °C lúc hiệu chuẩn, Ω·m
    kappa: float = 0.0           # 1/MPa
    c2: float = 0.0              # 1/MPa²
    kT: float = 0.0              # 1/(MPa·°C)
    kW: float = 0.0              # 1/(MPa·%)
    cov: list = field(default_factory=list)   # hiệp phương sai [kappa, c2, kT]
    x_sd: float = 0.0            # nhiễu của x lúc ép (tương đối)
    Tc: float = 25.0             # nhiệt độ tham chiếu khi ép
    Wc: float = 0.0              # độ ẩm lúc ép
    s_max: float = 12.0          # ứng suất lớn nhất đã ép, MPa
    T_range: tuple = (15.0, 45.0)
    # mốc lắp đặt (đo trước khi cho tải)
    install: dict | None = None  # {rho0, T, W, rho_ref, a_ref, time}
    metrics: dict = field(default_factory=dict)
    source: str = "calibrated"   # calibrated | prior
    version: str = VERSION

    def to_json(self) -> dict:
        d = asdict(self); d["T_range"] = list(self.T_range); return d

    @classmethod
    def from_json(cls, d: dict) -> "HybridParams":
        d = dict(d); d.pop("version", None)
        if "T_range" in d:
            d["T_range"] = tuple(d["T_range"])
        known = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        return cls(**known)


# ---------------------------------------------------------------- huấn luyện
def fit_temperature(T, rho, mix="F2", prior=None):
    """Quét nhiệt không tải: ln(rho) = ln(rho20) + a*(T-20). Trả về (a, a_sd, rho20)."""
    T = np.asarray(T, float); rho = np.asarray(rho, float)
    ok = np.isfinite(T) & np.isfinite(rho) & (rho > 0)
    T, rho = T[ok], rho[ok]
    prior = prior or prior_for(mix)
    rho20_guess = float(np.exp(np.mean(np.log(rho)))) if len(rho) else prior["rho20"][0]
    a_p = 1.2 * alpha_eq(rho20_guess)
    a_ps = abs(a_p) * prior["a_rel_sd"] + 2e-4
    if len(T) >= 2 and np.ptp(T) >= 5:
        X = np.c_[np.ones_like(T), T - T_REF]
        mean, cov, _ = _bayes_linreg(X, np.log(rho), [math.log(rho20_guess), a_p], [5.0, a_ps])
        return float(mean[1]), float(math.sqrt(cov[1, 1])), float(math.exp(mean[0]))
    if len(T) >= 1:
        rho20 = float(np.exp(np.mean(np.log(rho) - a_p * (T - T_REF))))
        return a_p, a_ps, rho20
    return a_p, a_ps, rho20_guess


def fit_press(sigma, rho, T, a, cycle=None, W=None, mix="F2", prior=None):
    """Ép theo bậc. Trả về dict tham số kappa, c2, kT, hiệp phương sai, nhiễu, chỉ số đánh giá."""
    s = np.asarray(sigma, float); rho = np.asarray(rho, float); T = np.asarray(T, float)
    T = np.where(np.isfinite(T), T, np.nanmean(T) if np.isfinite(T).any() else 25.0)
    cyc = np.zeros(len(s), int) if cycle is None else np.asarray(cycle)
    Wv = np.zeros(len(s)) if W is None else np.nan_to_num(np.asarray(W, float), nan=0.0)
    prior = prior or prior_for(mix)
    if len(s) < 3 or np.ptp(s) <= 0:
        raise ValueError("Cần ít nhất 3 bậc tải với ít nhất 2 mức tải khác nhau")
    # mốc 0 của từng lần/chu kỳ: các bậc có ứng suất nhỏ nhất
    x = np.empty(len(s))
    for c in np.unique(cyc):
        m = cyc == c
        z = m & (s <= s[m].min() + 1e-9)
        r0, T0 = float(np.mean(rho[z])), float(np.mean(T[z]))
        x[m] = rho[m] / (r0 * np.exp(a * (T[m] - T0))) - 1   # bậc nhỏ nhất (nên là 0 MPa) làm mốc
    Tc = float(np.mean(T)); Wc = float(np.mean(Wv))
    multiT = np.ptp(T) >= 8
    k_p, k_s = prior["kappa"]; c_p, c_s = prior["c2"]; g_p, g_s = prior["gT"]
    if multiT:
        X = np.c_[s, s**2, s * (T - Tc)]
        m0 = [k_p, c_p, k_p * g_p]; s0 = [abs(k_s), c_s, abs(k_p) * g_s + 1e-6]
    else:
        X = np.c_[s, s**2]
        m0 = [k_p, c_p]; s0 = [abs(k_s), c_s]
    mean, cov, sd = _bayes_linreg(X, x, m0, s0)
    kappa, c2 = float(mean[0]), float(mean[1])
    if multiT:
        kT = float(mean[2]); cov3 = cov
    else:
        kT = kappa * g_p
        cov3 = np.zeros((3, 3)); cov3[:2, :2] = cov; cov3[2, 2] = (abs(kappa) * g_s) ** 2
    pred_x = X @ mean
    ss_res = float(np.sum((x - pred_x) ** 2)); ss_tot = float(np.sum((x - x.mean()) ** 2))
    # kiểm tra chéo: bỏ từng chu kỳ ra, khớp lại, tính sai số theo MPa
    cv = []
    cycles = np.unique(cyc)
    if len(cycles) >= 2:
        for c in cycles:
            tr, te = cyc != c, cyc == c
            mtr, _, _ = _bayes_linreg(X[tr], x[tr], m0, s0)
            kk = mtr[0] + (mtr[2] * (T[te] - Tc) if multiT else 0)
            s_hat = invert(x[te], kk, mtr[1])
            cv.append(s_hat - s[te])
    cv_rmse = float(np.sqrt(np.mean(np.square(np.concatenate(cv))))) if cv else None
    s_fit = invert(x, kappa + kT * (T - Tc), c2)
    hyst = None
    if len(np.unique(np.round(s, 3))) < len(s):
        diffs = []
        for c in cycles:
            m = cyc == c
            for lv in np.unique(np.round(s[m], 3)):
                idx = np.where(m & (np.round(s, 3) == lv))[0]
                if len(idx) >= 2:
                    diffs.append(abs(s_fit[idx[-1]] - s_fit[idx[0]]))
        hyst = float(np.max(diffs)) if diffs else None
    return {
        "kappa": kappa, "c2": c2, "kT": kT, "kW": kappa * prior["gW"][0], "cov": cov3.tolist(),
        "x_sd": sd, "Tc": Tc, "Wc": Wc, "s_max": float(s.max()),
        "metrics": {"r2": 1 - ss_res / ss_tot if ss_tot > 0 else 1.0,
                    "rmse_mpa": float(np.sqrt(np.mean((s_fit - s) ** 2))),
                    "cv_rmse_mpa": cv_rmse, "hysteresis_mpa": hyst,
                    "n_steps": int(len(s)), "n_cycles": int(len(cycles)), "multi_temperature": bool(multiT)},
    }


def fit_block(mix, temp_sweep=None, press=None, prior=None) -> HybridParams:
    """Huấn luyện một cục.
    temp_sweep: dict(T=[...], rho=[...], W=[...]) hoặc None.
    press: dict(sigma=[...], rho=[...], T=[...], cycle=[...], W=[...]) hoặc None (khi chưa ép -> chỉ dùng prior).
    """
    prior = prior or prior_for(mix)
    if temp_sweep and len(temp_sweep.get("T", [])):
        a, a_sd, rho20 = fit_temperature(temp_sweep["T"], temp_sweep["rho"], mix, prior)
        T_lo, T_hi = float(np.min(temp_sweep["T"])), float(np.max(temp_sweep["T"]))
    elif press:
        z = np.asarray(press["sigma"], float) <= np.min(press["sigma"]) + 1e-9
        a, a_sd, rho20 = fit_temperature(np.asarray(press["T"], float)[z], np.asarray(press["rho"], float)[z], mix, prior)
        T_lo, T_hi = 20.0, 35.0
    else:
        raise ValueError("Cần dữ liệu quét nhiệt hoặc ép theo bậc")
    b = 0.9 * beta_eq(rho20)
    hp = HybridParams(mix=mix, a=a, a_sd=a_sd, b=b, rho20=rho20, T_range=(min(T_lo, 15.0), max(T_hi, 40.0)))
    if press:
        f = fit_press(press["sigma"], press["rho"], press["T"], a, press.get("cycle"), press.get("W"), mix, prior)
        for k in ("kappa", "c2", "kT", "kW", "cov", "x_sd", "Tc", "Wc", "s_max", "metrics"):
            setattr(hp, k, f[k])
        hp.source = "calibrated"
    else:
        k, ks = prior["kappa"]; c, cs = prior["c2"]
        hp.kappa, hp.c2, hp.kT, hp.kW = k, c, k * prior["gT"][0], k * prior["gW"][0]
        hp.cov = np.diag([ks**2, cs**2, (abs(k) * prior["gT"][1]) ** 2]).tolist()
        hp.x_sd, hp.Tc, hp.s_max = 5e-4, 25.0, 12.0
        hp.source = "prior"
        hp.metrics = {"note": "Chưa ép: độ nhạy lấy theo trung bình cấp phối, sai số lớn"}
    return hp


# ---------------------------------------------------------------- dự đoán
def invert(x, B, A):
    """Giải A*s^2 + B*s - x = 0, chọn nghiệm gần x/B (nhánh vật lý)."""
    x = np.asarray(x, float); B = np.broadcast_to(np.asarray(B, float), x.shape)
    lin = x / B
    if abs(float(np.max(np.abs(A)))) < 1e-12:
        return lin
    disc = np.sqrt(np.maximum(B**2 + 4 * A * x, 0.0))
    r1 = (-B + disc) / (2 * A); r2 = (-B - disc) / (2 * A)
    return np.where(np.abs(r1 - lin) <= np.abs(r2 - lin), r1, r2)


@dataclass
class Prediction:
    stress: np.ndarray       # MPa
    lo: np.ndarray           # cận dưới 95%
    hi: np.ndarray           # cận trên 95%
    flag: str                # ok | prior | out_of_range | no_zero


def baseline(p: HybridParams, T, W=None, rho_ref=None, days=None):
    """Nền không tải rho0 hiện tại và độ lệch chuẩn tương đối của nó."""
    T = np.asarray(T, float)
    ins = p.install
    if ins and rho_ref is not None and ins.get("rho_ref"):
        a_ref = ins.get("a_ref", p.a)
        r0 = rho_ref * (ins["rho0"] / ins["rho_ref"]) * np.exp((p.a - a_ref) * (T - ins["T"]))
        rel = math.sqrt(0.004**2 + (2 * p.a_sd * 0.5) ** 2)       # chênh lệch giữa hai cục
        return r0, rel
    if ins:
        r0 = ins["rho0"] * np.exp(p.a * (T - ins["T"]))
        if W is not None and ins.get("W") is not None:
            r0 = r0 * np.exp(p.b * (np.asarray(W, float) - ins["W"]))
            rel_w = 0.02 * abs(p.b) * 10                           # cảm biến ẩm sai ±0,02%
        else:
            rel_w = 0.012                                          # ẩm không đo: ~±0,15% độ ẩm
        age = 0.0 if days is None else 0.01 * math.log1p(max(days, 0) / 30.0)
        rel = math.sqrt(rel_w**2 + age**2 + (p.a_sd * float(np.mean(np.abs(T - ins["T"])))) ** 2)
        return r0, rel
    r0 = p.rho20 * np.exp(p.a * (T - T_REF))                         # chưa có mốc lắp: dùng số phòng thí nghiệm
    return r0, 0.03


def predict(p: HybridParams, rho, T, W=None, rho_ref=None, days=None) -> Prediction:
    rho = np.asarray(rho, float)
    if T is None:
        T = p.Tc
    T = np.broadcast_to(np.asarray(T, float), rho.shape).astype(float)
    if np.isnan(T).all():
        T = np.full(rho.shape, p.Tc)
    r0, rel = baseline(p, T, W, rho_ref, days)
    x = rho / r0 - 1
    dW = 0.0 if W is None else float(np.nanmean(W)) - p.Wc
    B = p.kappa + p.kT * (T - p.Tc) + p.kW * dW
    s = invert(x, B, p.c2)
    # khoảng tin cậy (xấp xỉ bậc nhất): nhiễu x + nền + tham số
    cov = np.asarray(p.cov, float) if p.cov else np.zeros((3, 3))
    sm = float(np.nanmean(s)) if np.isfinite(s).any() else 0.0
    sm_g = min(max(sm, -1.0), 1.5 * p.s_max)                     # đạo hàm chỉ tin trong vùng đã ép
    Tm = float(np.nanmean(T))
    Bm = p.kappa + p.kT * (Tm - p.Tc)
    dBm = Bm + 2 * p.c2 * sm_g
    floor = 0.3 * abs(p.kappa) if p.kappa else 1e-6
    if abs(dBm) < floor:
        dBm = math.copysign(floor, dBm if dBm else p.kappa or 1.0)
    g = np.array([sm_g, sm_g**2, sm_g * (Tm - p.Tc)]) / dBm       # ∂σ/∂θ
    var = float(g @ cov @ g) + (rel**2 + p.x_sd**2) / dBm**2
    half = 1.96 * math.sqrt(max(var, 0.0))
    flag = "ok"
    if p.source == "prior":
        flag = "prior"
    if not p.install:
        flag = "no_zero"
    if sm > p.s_max * 1.1 or sm < -1.0 or Tm < p.T_range[0] - 3 or Tm > p.T_range[1] + 3:
        flag = "out_of_range"
    return Prediction(s, s - half, s + half, flag)


# ---------------------------------------------------------------- đàn và trôi
def fleet_stats(params: list[HybridParams]) -> dict:
    """Prior của cấp phối từ các cục đã ép (chỉ cục source=calibrated)."""
    ps = [p for p in params if p.source == "calibrated"]
    out = {"n": len(ps)}
    if len(ps) >= 2:
        for k in ("kappa", "c2"):
            v = np.array([getattr(p, k) for p in ps])
            out[k] = [float(v.mean()), float(max(v.std(ddof=1), 1e-6))]
        g = np.array([p.kT / p.kappa for p in ps
                      if abs(p.kappa) > 1e-9 and p.metrics.get("multi_temperature")])   # chỉ cục ép ở >= 2 nhiệt độ
        if len(g) >= 2:
            out["gT"] = [float(g.mean()), float(max(g.std(ddof=1), 1e-5))]
        out["a"] = [float(np.mean([p.a for p in ps])), float(np.std([p.a for p in ps], ddof=1))]
    return out


def cusum(values, target=0.0, k=0.5, h=4.0):
    """CUSUM hai phía trên chuỗi đã chuẩn hóa. Trả về chỉ số đầu tiên vượt ngưỡng hoặc None."""
    sp = sn = 0.0
    for i, v in enumerate(values):
        z = v - target
        sp = max(0.0, sp + z - k); sn = max(0.0, sn - z - k)
        if sp > h or sn > h:
            return i
    return None


def drift_report(p: HybridParams, daily: list[dict]) -> dict:
    """daily: [{day, stress_min, stress_med, noise, ref_env}] tính từ dữ liệu 1 phút.
    Ba dấu hiệu: mức ứng suất thấp nhất trong ngày trôi, nhiễu tăng, môi trường quanh cục đối chứng đổi nhanh."""
    flags = []
    if len(daily) >= 3:
        mins = np.array([d["stress_min"] for d in daily if d.get("stress_min") is not None], float)
        if len(mins) >= 3:
            slope = float(np.polyfit(np.arange(len(mins)), mins, 1)[0])
            if abs(slope) * 7 > 1.0:
                flags.append({"code": "baseline_trend", "detail": f"Mức tải thấp nhất trôi {slope * 7:+.2f} MPa/tuần"})
            idx = cusum((mins - mins[0]) / 0.5)
            if idx is not None:
                flags.append({"code": "baseline_shift", "detail": f"Mức tải thấp nhất đổi rõ từ ngày thứ {idx + 1}"})
        noise = [d["noise"] for d in daily if d.get("noise") is not None]
        if noise and p.x_sd > 0 and noise[-1] > 5 * p.x_sd:
            flags.append({"code": "noise", "detail": "Nhiễu tăng hơn 5 lần lúc hiệu chuẩn: kiểm tra điện cực, dây"})
        env = [d["ref_env"] for d in daily if d.get("ref_env") is not None]
        if len(env) >= 2 and abs(env[-1] - env[0]) > 0.03:
            flags.append({"code": "environment", "detail": "Điện trở suất cục đối chứng đổi hơn 3%: độ ẩm hoặc tuổi bê tông đang đổi"})
    return {"flags": flags, "status": "check" if flags else "ok"}

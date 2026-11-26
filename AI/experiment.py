"""Thử các cách hiệu chuẩn / dự đoán ứng suất trên dữ liệu giả lập.  python experiment.py"""
import json
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import RBF, WhiteKernel, ConstantKernel as C
from ssc_sim import Block, lab_press, lab_temp_sweep, field, alpha_eq, beta_eq, G_T, G_W

rng = np.random.default_rng(7)
rmse = lambda e: float(np.sqrt(np.mean(np.square(e))))

# ---------------------------------------------------------------- A. đường cong hiệu chuẩn trong phòng thí nghiệm
def fit_inverse(x, s, kind):
    if kind == "linear":
        c = np.polyfit(x, s, 1); return lambda z: np.polyval(c, z)
    if kind == "quad":
        c = np.polyfit(x, s, 2); return lambda z: np.polyval(c, z)
    gp = GaussianProcessRegressor(C(1.0) * RBF(0.02, (1e-3, 1)) + WhiteKernel(0.01), normalize_y=True).fit(x[:, None], s)
    return lambda z: gp.predict(np.asarray(z)[:, None])

labA = {}
for step_name, step in [("3 bậc (0, 6, 12)", 6.0), ("4 bậc (cách 4)", 4.0), ("7 bậc (cách 2)", 2.0), ("13 bậc (cách 1)", 1.0)]:
    errs = {k: [] for k in ("linear", "quad", "gp")}
    for b in range(30):
        blk = Block(rng)
        cal = lab_press(blk, rng, step=step, cycles=2)
        test = lab_press(blk, rng, step=1.0, cycles=1)
        r0 = cal[cal[:, 1] == 0, 3].mean()
        x, s = cal[:, 3] / r0 - 1, cal[:, 1]
        for k in errs:
            f = fit_inverse(x, s, k); errs[k].append(rmse(f(test[:, 3] / r0 - 1) - test[:, 1]))
    labA[step_name] = {k: float(np.mean(v)) for k, v in errs.items()}

# ---------------------------------------------------------------- B. hiện trường 60 ngày
def keq(r): return -0.015 * r + 0.20

def run_field(scen="TWA", n_blocks=20):
    out = {}
    # tập huấn luyện cho học máy thuần: ép ở nhiều nhiệt độ trên 30 cục khác
    Xtr, ytr = [], []
    for _ in range(30):
        b = Block(rng)
        r_ref = b.rho(0.0, 25.0, 0.0, -30, rng)
        for T in (15, 25, 35, 45):
            p = lab_press(b, rng, T=T, cycles=1)
            Xtr += [[r / r_ref - 1, t - 25] for r, t in zip(p[:, 3], p[:, 2])]; ytr += list(p[:, 1])
    gbm = HistGradientBoostingRegressor(max_iter=300).fit(np.array(Xtr), np.array(ytr))

    res = {k: [] for k in ["L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7"]}
    example = None
    for j in range(n_blocks):
        env = field(rng)
        if "W" not in scen:
            env["W"] = np.full_like(env["W"], 0.8)
        blk = Block(rng); twin = Block(rng, batch=blk)
        if "A" not in scen:
            blk.d = twin.d = 0.0
        t, Ta, Ti, W, sig = env["t"], env["T_air"], env["T_in"], env["W"], env["sigma"]
        rho = blk.rho(sig, Ti, W, t, rng); rho_d = twin.rho(0 * sig, Ti, W, t, rng)
        W_meas = W + rng.normal(0, 0.15, len(t))
        press = lab_press(blk, rng); sweep = lab_temp_sweep(blk, rng)
        i0 = 0                                                   # lúc lắp đặt, chưa tải
        Tcal = press[:, 2].mean(); r0cal = press[press[:, 1] == 0, 3].mean()
        K, _ = np.polyfit(press[:, 1], press[:, 3] - r0cal, 1)  # tuyến tính tuyệt đối (server hiện tại)
        a_eq = 1.2 * alpha_eq(r0cal); b_eq = 0.9 * beta_eq(r0cal)
        # L0: không ép, kappa trung bình đàn, zero lúc lắp, nhiệt không khí
        base = rho[i0] * np.exp(a_eq * (Ta - Ta[i0]))
        res["L0"].append((rho / base - 1) / -0.0034)
        # L1: server hiện tại (model.py ActiveModel kind=linear, W = 0)
        rho0_ref = r0cal * np.exp(-a_eq * (Tcal - 20))
        r0 = rho0_ref * np.exp(a_eq * (Ta - 20)); k = K * keq(r0) / keq(r0cal)
        res["L1"].append((rho - r0) / k)
        # L2: + đo lại rho0 lúc lắp đặt
        r0 = rho[i0] * np.exp(a_eq * (Ta - Ta[i0])); k = K * keq(r0) / keq(r0cal)
        res["L2"].append((rho - r0) / k)
        # L3: + đầu dò nhiệt trong cục
        r0 = rho[i0] * np.exp(a_eq * (Ti - Ti[i0])); k = K * keq(r0) / keq(r0cal)
        res["L3"].append((rho - r0) / k)
        # L4: mô hình lai: a riêng (quét nhiệt), bậc hai tương đối, kappa theo T
        a_i = np.polyfit(sweep[:, 0], np.log(sweep[:, 1]), 1)[0]
        x = press[:, 3] / r0cal - 1
        c2, c1, _ = np.polyfit(press[:, 1], x, 2)                # x = kappa*s + kappa*q*s^2
        def inv(xr, scale):
            A, B = c2 * scale, c1 * scale
            roots = np.stack([(-B + np.sqrt(np.maximum(B**2 + 4 * A * xr, 0))) / (2 * A),
                              (-B - np.sqrt(np.maximum(B**2 + 4 * A * xr, 0))) / (2 * A)])
            return roots[np.argmin(np.abs(roots - xr / B), axis=0), np.arange(len(xr))]
        sc_T = (1 + G_T * (Ti - 20)) / (1 + G_T * (Tcal - 20))
        r0 = rho[i0] * np.exp(a_i * (Ti - Ti[i0]))
        res["L4"].append(inv(rho / r0 - 1, sc_T))
        # L5: + cảm biến ẩm trong cục
        r0w = r0 * np.exp(b_eq * (W_meas - W_meas[i0]))
        sc_TW = sc_T * (1 + G_W * W_meas) / (1 + G_W * 0.0)
        res["L5"].append(inv(rho / r0w - 1, sc_TW))
        # L6: + cục đối chứng không tải cùng mẻ (thay cho cảm biến ẩm)
        sw_d = lab_temp_sweep(twin, rng); a_d = np.polyfit(sw_d[:, 0], np.log(sw_d[:, 1]), 1)[0]
        r0d = rho_d * (rho[i0] / rho_d[i0]) * np.exp((a_i - a_d) * (Ti - Ti[i0]))
        res["L6"].append(inv(rho / r0d - 1, sc_T))
        # L7: học máy thuần (GBM gộp 30 cục, ép ở 4 nhiệt độ), zero lúc lắp
        res["L7"].append(gbm.predict(np.c_[rho / rho[i0] - 1, Ti - Ti[i0]]))
        for kk in res:
            res[kk][-1] = res[kk][-1] - sig                      # lưu sai số
        if j == 0:
            example = dict(t=t, sigma=sig, err={kk: res[kk][-1] for kk in ("L1", "L4", "L6")}, T=Ti, W=W)
    for kk, v in res.items():
        e = np.concatenate([x[env["t"] > 1] for x in v])
        out[kk] = {"rmse": rmse(e), "p95": float(np.percentile(np.abs(e), 95))}
    return out, example

fieldB = {}
for scen in ("T", "TW", "TWA"):
    fieldB[scen], ex_s = run_field(scen)
    if scen == "TWA":
        ex = ex_s
json.dump({"labA": labA, "fieldB": fieldB}, open("results.json", "w"), ensure_ascii=False, indent=1)
# sai số trung bình theo ngày (có dấu) của cục ví dụ, kịch bản đủ T + W + già hóa
step = 144
daily = [{"day": int(i // step), **{k: round(float(np.mean(ex["err"][k][i:i + step])), 2) for k in ex["err"]},
          "W": round(float(np.mean(ex["W"][i:i + step])), 3)} for i in range(0, len(ex["t"]), step)]
json.dump(daily, open("example_err.json", "w"))
print(json.dumps({"labA": labA, "fieldB": fieldB}, ensure_ascii=False, indent=1))

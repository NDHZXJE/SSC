"""Tạo template trống và một bản điền sẵn bằng dữ liệu giả lập (để thử train.py).

    python make_templates.py
    -> SSC_template_du_lieu.xlsx (trống), SSC_template_mau_gia_lap.xlsx (điền sẵn, 12 cục đo + 12 cục đối chứng)
"""
import os
import sys
from datetime import datetime, timedelta

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Server", "api"))
from app import dataset  # noqa: E402
from ssc_sim import Block, lab_press, lab_temp_sweep, field  # noqa: E402

A_MM2, L_MM, AC_MM2 = 2000.0, 30.0, 2500.0


def sample(n_blocks=12, seed=11):
    rng = np.random.default_rng(seed)
    t = {k: [] for k in dataset.SHEETS}
    t0 = datetime(2026, 12, 1, 8, 0)
    for i in range(1, n_blocks + 1):
        code, ref = f"SSC-{i:03d}", f"REF-{i:03d}"
        blk = Block(rng); twin = Block(rng, batch=blk)
        for c, is_ref in ((code, False), (ref, True)):
            t["Cuc"].append({"ma_cuc": c, "cap_phoi": "F2", "me_duc": f"M{(i - 1) // 4 + 1}", "ngay_duc": "2026-10-15",
                             "cuong_do_nen_mpa": 60, "dien_tich_dien_cuc_mm2": A_MM2, "khoang_cach_dien_cuc_mm": L_MM,
                             "dien_tich_chiu_nen_mm2": AC_MM2, "la_cuc_doi_chung": "co" if is_ref else "",
                             "ma_cuc_doi_chung": "" if is_ref else ref, "vi_tri": f"Cột C{i}"})
        for b, c in ((blk, code), (twin, ref)):
            for T, rho in lab_temp_sweep(b, rng):
                t["QuetNhiet"].append({"ma_cuc": c, "nhiet_do_c": round(T + rng.normal(0, 0.2), 2), "do_am_pct": 0,
                                       "rho_ohm_m": round(rho, 5), "so_mau": 6000})
        for j, (cyc, s, T, rho) in enumerate(lab_press(blk, rng)):
            t["EpBac"].append({"ma_cuc": code, "lan_ep": 1, "chu_ky": int(cyc) + 1, "tai_kn": round(s * AC_MM2 / 1000, 2),
                               "rho_ohm_m": round(rho, 5), "nhiet_do_c": round(T, 2), "do_am_pct": 0,
                               "thoi_diem": t0 + timedelta(days=i, seconds=40 * j)})
        env = field(rng)
        tt, Ti, W, sig = env["t"], env["T_in"], env["W"], env["sigma"]
        rho = blk.rho(sig, Ti, W, tt, rng); rho_d = twin.rho(0 * sig, Ti, W, tt, rng)
        t_ins = datetime(2027, 1, 1, 7, 0)
        t["LapDat"].append({"ma_cuc": code, "thoi_diem": t_ins, "rho0_ohm_m": round(rho[0], 5),
                            "nhiet_do_c": round(Ti[0], 2), "rho_doi_chung_ohm_m": round(rho_d[0], 5)})
        for k in range(144 + 20, len(tt), 144):      # mỗi ngày một điểm biết tải
            t["KiemChung"].append({"ma_cuc": code, "thoi_diem": t_ins + timedelta(days=float(tt[k])),
                                   "ung_suat_that_mpa": round(sig[k], 3), "rho_ohm_m": round(rho[k], 5),
                                   "nhiet_do_c": round(Ti[k], 2), "rho_doi_chung_ohm_m": round(rho_d[k], 5)})
    return t


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    open(os.path.join(here, "SSC_template_du_lieu.xlsx"), "wb").write(dataset.write_template())
    open(os.path.join(here, "SSC_template_mau_gia_lap.xlsx"), "wb").write(dataset.write_template(sample()))
    print("Đã tạo SSC_template_du_lieu.xlsx và SSC_template_mau_gia_lap.xlsx")

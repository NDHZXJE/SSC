"""Huấn luyện mô hình AI lai từ file template Excel và kiểm tra trên sheet KiemChung.

    python train.py du_lieu.xlsx                 # in báo cáo, ghi models.json
    python train.py du_lieu.xlsx --out ketqua.json

Dùng chung mã với server (Server/api/app/hybrid.py, dataset.py).
"""
import argparse
import json
import os
import sys
from datetime import datetime

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Server", "api"))
from app import dataset, hybrid  # noqa: E402


def _days(a, b):
    try:
        return (a - b).total_seconds() / 86400.0
    except Exception:
        return None


def train(tables):
    sets = dataset.training_sets(tables)
    refs = {c for c, s in sets.items() if str(s["block"].get("la_cuc_doi_chung") or "").lower().startswith("c")}
    # Lượt 1: prior mặc định. Lượt 2: prior từ đàn nếu đủ 5 cục đã ép cùng cấp phối.
    models, fleet = {}, {}
    for pass_no in (1, 2):
        by_mix = {}
        for code, s in sets.items():
            mix = str(s["block"].get("cap_phoi") or "F2").upper()
            if not s["temp_sweep"] and not s["press"]:
                continue
            prior = hybrid.prior_for(mix, fleet.get(mix))
            p = hybrid.fit_block(mix, s["temp_sweep"], s["press"] if code not in refs else None, prior)
            models[code] = p
            by_mix.setdefault(mix, []).append(p)
        fleet = {m: hybrid.fleet_stats(ps) for m, ps in by_mix.items()}
        if not any(f.get("n", 0) >= 5 for f in fleet.values()):
            break
    # mốc lắp đặt
    for code, s in sets.items():
        ins = s["install"]
        if code in models and ins:
            ref_code = s["block"].get("ma_cuc_doi_chung")
            models[code].install = {
                "rho0": float(ins["rho0_ohm_m"]), "T": float(ins["nhiet_do_c"]),
                "W": None if ins.get("do_am_pct") is None else float(ins["do_am_pct"]),
                "rho_ref": None if ins.get("rho_doi_chung_ohm_m") is None else float(ins["rho_doi_chung_ohm_m"]),
                "a_ref": models[ref_code].a if ref_code in models else None,
                "time": str(ins.get("thoi_diem")),
            }
            if models[code].install["a_ref"] is None:
                models[code].install.pop("a_ref")
    # kiểm chứng
    report = {}
    for code, s in sets.items():
        if code not in models or code in refs:
            continue
        p = models[code]
        row = {"source": p.source, **{k: v for k, v in p.metrics.items() if not isinstance(v, str)}}
        chk = s["checks"]
        if chk and p.install:
            t_ins = s["install"].get("thoi_diem")
            errs, inside = [], 0
            for r in chk:
                rr = r.get("rho_doi_chung_ohm_m")
                pr = hybrid.predict(p, [float(r["rho_ohm_m"])], float(r["nhiet_do_c"]),
                                    rho_ref=None if rr is None else float(rr),
                                    days=_days(r.get("thoi_diem"), t_ins) if isinstance(t_ins, datetime) else None)
                truth = float(r["ung_suat_that_mpa"])
                errs.append(float(pr.stress[0]) - truth)
                inside += int(pr.lo[0] <= truth <= pr.hi[0])
            e = np.array(errs)
            row.update({"field_rmse_mpa": float(np.sqrt(np.mean(e**2))), "field_bias_mpa": float(e.mean()),
                        "field_n": len(e), "ci95_coverage": inside / len(e)})
        report[code] = row
    return models, fleet, report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("--out", default="models.json")
    a = ap.parse_args()
    tables, errors = dataset.read_template(open(a.xlsx, "rb").read())
    for e in errors:
        print("Lỗi dữ liệu:", e)
    models, fleet, report = train(tables)
    json.dump({"models": {k: v.to_json() for k, v in models.items()}, "fleet": fleet, "report": report},
              open(a.out, "w"), ensure_ascii=False, indent=1, default=str)
    print(f"{'cục':10s} {'nguồn':10s} {'RMSE ép':>8s} {'CV ép':>7s} {'RMSE HT':>8s} {'phủ 95%':>8s}")
    for code, r in report.items():
        f = lambda k, fmt="{:.2f}": fmt.format(r[k]) if r.get(k) is not None else "-"
        print(f"{code:10s} {r['source']:10s} {f('rmse_mpa'):>8s} {f('cv_rmse_mpa'):>7s} {f('field_rmse_mpa'):>8s} {f('ci95_coverage', '{:.0%}'):>8s}")
    print("Prior đàn:", json.dumps(fleet, ensure_ascii=False))
    print("Đã ghi", a.out)

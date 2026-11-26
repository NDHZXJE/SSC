"""Template Excel dữ liệu huấn luyện mô hình AI và hàm đọc/ghi nó.

Mỗi sheet: hàng 1 là tên cột (máy đọc), hàng 2 là mô tả và đơn vị, dữ liệu từ hàng 3.
Cột có dấu * trong mô tả là bắt buộc. Server xuất ra đúng mẫu này từ dữ liệu tự thu,
nên dữ liệu nhập tay và dữ liệu tự động dùng chung một định dạng.
"""
from __future__ import annotations

import io
from datetime import date, datetime

import numpy as np

# (tên cột, mô tả, bắt buộc)
SHEETS: dict[str, list[tuple[str, str, bool]]] = {
    "Cuc": [
        ("ma_cuc", "Mã cục, như in trên cục", True),
        ("cap_phoi", "Cấp phối: F2, F1P1...", True),
        ("me_duc", "Mã mẻ đúc (các cục cùng mẻ dùng chung prior)", False),
        ("ngay_duc", "Ngày đúc (yyyy-mm-dd)", False),
        ("cuong_do_nen_mpa", "Cường độ nén fc, MPa (giới hạn ép: 20% fc)", False),
        ("dien_tich_dien_cuc_mm2", "Diện tích điện cực A, mm²", True),
        ("khoang_cach_dien_cuc_mm", "Khoảng cách hai điện cực L, mm", True),
        ("dien_tich_chiu_nen_mm2", "Diện tích chịu nén, mm²", True),
        ("la_cuc_doi_chung", "co nếu là cục đối chứng không tải", False),
        ("ma_cuc_doi_chung", "Mã cục đối chứng đi kèm (nếu có)", False),
        ("vi_tri", "Vị trí lắp", False),
        ("ghi_chu", "Ghi chú", False),
    ],
    "QuetNhiet": [
        ("ma_cuc", "Mã cục *", True),
        ("thoi_diem", "Thời điểm đo (yyyy-mm-dd hh:mm)", False),
        ("nhiet_do_c", "Nhiệt độ trong cục, °C *", True),
        ("do_am_pct", "Độ ẩm khối lượng W, %", False),
        ("rho_ohm_m", "Điện trở suất trung bình, Ω·m (hoặc điền rs_ohm)", False),
        ("rs_ohm", "Điện trở SSC, Ω (nếu không có rho)", False),
        ("rho_std", "Độ lệch chuẩn rho trong lúc đo, Ω·m", False),
        ("so_mau", "Số mẫu lấy trung bình", False),
        ("ghi_chu", "Ghi chú", False),
    ],
    "EpBac": [
        ("ma_cuc", "Mã cục *", True),
        ("lan_ep", "Số thứ tự lần ép (1, 2...) *", True),
        ("chu_ky", "Chu kỳ trong lần ép (1, 2, 3) *", True),
        ("tai_kn", "Lực máy nén, kN (hoặc điền ung_suat_mpa)", False),
        ("ung_suat_mpa", "Ứng suất, MPa (tự tính từ tai_kn nếu trống)", False),
        ("rho_ohm_m", "Điện trở suất trung bình ở bậc, Ω·m (hoặc rs_ohm)", False),
        ("rs_ohm", "Điện trở SSC, Ω", False),
        ("rho_std", "Độ lệch chuẩn rho trong bậc, Ω·m", False),
        ("nhiet_do_c", "Nhiệt độ trong cục, °C *", True),
        ("do_am_pct", "Độ ẩm W, %", False),
        ("thoi_diem", "Thời điểm bắt đầu bậc", False),
        ("ghi_chu", "Ghi chú", False),
    ],
    "LapDat": [
        ("ma_cuc", "Mã cục *", True),
        ("thoi_diem", "Thời điểm đo mốc, trước khi cho tải *", True),
        ("rho0_ohm_m", "rho lúc chưa tải, Ω·m *", True),
        ("nhiet_do_c", "Nhiệt độ trong cục, °C *", True),
        ("do_am_pct", "Độ ẩm W, % (nếu đo được)", False),
        ("rho_doi_chung_ohm_m", "rho của cục đối chứng cùng lúc, Ω·m", False),
        ("ghi_chu", "Ghi chú", False),
    ],
    "KiemChung": [
        ("ma_cuc", "Mã cục *", True),
        ("thoi_diem", "Thời điểm *", True),
        ("ung_suat_that_mpa", "Ứng suất biết trước (quả nặng, máy nén), MPa *", True),
        ("rho_ohm_m", "rho đo được, Ω·m *", True),
        ("nhiet_do_c", "Nhiệt độ trong cục, °C *", True),
        ("do_am_pct", "Độ ẩm W, %", False),
        ("rho_doi_chung_ohm_m", "rho cục đối chứng cùng lúc, Ω·m", False),
        ("ghi_chu", "Ghi chú", False),
    ],
}

GUIDE = [
    ("Mục đích", "Dữ liệu để huấn luyện mô hình AI lai cho từng cục bê tông tự cảm biến (SSC)."),
    ("Cách điền", "Hàng 1 là tên cột, đừng sửa. Hàng 2 là mô tả. Điền dữ liệu từ hàng 3. Cột có * là bắt buộc."),
    ("Cuc", "Mỗi cục một dòng, gồm cả cục đối chứng."),
    ("QuetNhiet", "Cục KHÔNG tải trong tủ nhiệt, ở 15, 25, 35, 45 °C. Mỗi mức một dòng, lấy trung bình 60 s sau khi nhiệt trong cục ổn định."),
    ("EpBac", "Ép 0 -> 12 MPa (dưới 20% fc) cách 2 MPa, lên rồi xuống, 3 chu kỳ, giữ mỗi bậc 30 s. Mỗi bậc một dòng. Bậc 0 MPa đầu mỗi chu kỳ là bắt buộc."),
    ("LapDat", "Đo rho 5 phút sau khi đặt cục vào công trình, trước khi cho tải. Có cục đối chứng thì ghi rho của nó cùng lúc."),
    ("KiemChung", "Không bắt buộc. Những lúc biết chắc tải (quả nặng cố định, thử tải) để kiểm tra mô hình ngoài hiện trường."),
    ("Đơn vị", "rho: Ω·m. Nếu chỉ có điện trở Rs (Ω) thì điền rs_ohm, rho = Rs·A/L sẽ tự tính."),
    ("Tự động", "Server ghi các bảng này tự động khi dùng trang Hiệu chuẩn, và xuất lại đúng mẫu này ở API /api/ai/dataset.xlsx."),
]


# ---------------------------------------------------------------- ghi
def write_template(rows: dict[str, list[dict]] | None = None) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment

    wb = Workbook()
    ws = wb.active; ws.title = "HuongDan"
    ws.append(["Mục", "Nội dung"])
    for r in GUIDE:
        ws.append(list(r))
    ws.column_dimensions["A"].width = 14; ws.column_dimensions["B"].width = 120
    for c in ws[1]:
        c.font = Font(bold=True)
    head = PatternFill("solid", fgColor="DDEBF7"); req = PatternFill("solid", fgColor="FCE4D6")
    for name, cols in SHEETS.items():
        ws = wb.create_sheet(name)
        ws.append([c[0] for c in cols])
        ws.append([c[1] + (" *" if c[2] and not c[1].endswith("*") else "") for c in cols])
        for i, (key, _, required) in enumerate(cols, start=1):
            h = ws.cell(1, i); h.font = Font(bold=True); h.fill = req if required else head
            d = ws.cell(2, i); d.font = Font(italic=True, color="666666"); d.alignment = Alignment(wrap_text=True)
            ws.column_dimensions[h.column_letter].width = max(14, len(key) + 4)
        ws.row_dimensions[2].height = 45
        ws.freeze_panes = "A3"
        for r in (rows or {}).get(name, []):
            ws.append([_cell(r.get(c[0])) for c in cols])
    buf = io.BytesIO(); wb.save(buf)
    return buf.getvalue()


def _cell(v):
    if isinstance(v, (np.floating,)):
        return float(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, datetime) and v.tzinfo is not None:
        return v.replace(tzinfo=None)
    return v


# ---------------------------------------------------------------- đọc
def read_template(data: bytes) -> tuple[dict[str, list[dict]], list[str]]:
    """Trả về (các bảng, danh sách lỗi). Dòng thiếu cột bắt buộc bị bỏ và ghi lỗi."""
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(data), data_only=True)
    out, errors = {}, []
    for name, cols in SHEETS.items():
        out[name] = []
        if name not in wb.sheetnames:
            continue
        ws = wb[name]
        header = [str(c.value).strip() if c.value is not None else "" for c in ws[1]]
        for row_i, row in enumerate(ws.iter_rows(min_row=3, values_only=True), start=3):
            if row is None or all(v is None or str(v).strip() == "" for v in row):
                continue
            rec = {header[i]: row[i] for i in range(min(len(header), len(row))) if header[i]}
            rec["_row"] = row_i
            out[name].append(rec)
    return check_tables(out, errors), errors


def check_tables(t: dict, errors: list) -> dict:
    """Bỏ dòng thiếu cột bắt buộc, tính rho từ Rs và ứng suất từ kN. Dùng chung cho file Excel và trang nhập liệu."""
    for name, cols in SHEETS.items():
        keep = []
        for i, rec in enumerate(t.get(name, []), start=1):
            if rec.get("_db"):          # cục đã có trong hệ thống, chỉ để tra cứu
                keep.append(rec); continue
            missing = [c[0] for c in cols if c[2] and (rec.get(c[0]) is None or str(rec.get(c[0])).strip() == "")]
            if missing:
                errors.append(f"{name} dòng {rec.get('_row', i)}: thiếu {', '.join(missing)}")
                continue
            keep.append(rec)
        t[name] = keep
    _derive(t, errors)
    return t


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _derive(t: dict, errors: list):
    blocks = {str(r["ma_cuc"]).strip(): r for r in t.get("Cuc", [])}
    for r in t.get("Cuc", []):
        r["ma_cuc"] = str(r["ma_cuc"]).strip()
    for name in ("QuetNhiet", "EpBac", "LapDat", "KiemChung"):
        keep = []
        for r in t.get(name, []):
            r["ma_cuc"] = str(r["ma_cuc"]).strip()
            b = blocks.get(r["ma_cuc"])
            if b is None:
                errors.append(f"{name}: cục {r['ma_cuc']} chưa có trong sheet Cuc")
                continue
            if name in ("QuetNhiet", "EpBac") and _num(r.get("rho_ohm_m")) is None:
                rs = _num(r.get("rs_ohm"))
                if rs is None:
                    errors.append(f"{name}: cục {r['ma_cuc']} thiếu rho_ohm_m và rs_ohm")
                    continue
                r["rho_ohm_m"] = rs * _num(b["dien_tich_dien_cuc_mm2"]) * 1e-6 / (_num(b["khoang_cach_dien_cuc_mm"]) * 1e-3)
            if name == "EpBac" and _num(r.get("ung_suat_mpa")) is None:
                kn = _num(r.get("tai_kn"))
                if kn is None:
                    errors.append(f"EpBac: cục {r['ma_cuc']} thiếu tai_kn và ung_suat_mpa")
                    continue
                r["ung_suat_mpa"] = kn * 1000.0 / _num(b["dien_tich_chiu_nen_mm2"])
            keep.append(r)
        t[name] = keep


def training_sets(t: dict) -> dict[str, dict]:
    """Gom dữ liệu theo cục, sẵn sàng cho hybrid.fit_block."""
    out = {}
    for b in t.get("Cuc", []):
        code = b["ma_cuc"]
        sw = [r for r in t.get("QuetNhiet", []) if r["ma_cuc"] == code]
        pr = [r for r in t.get("EpBac", []) if r["ma_cuc"] == code]
        ins = [r for r in t.get("LapDat", []) if r["ma_cuc"] == code]
        chk = [r for r in t.get("KiemChung", []) if r["ma_cuc"] == code]
        out[code] = {
            "block": b,
            "temp_sweep": {"T": [_num(r["nhiet_do_c"]) for r in sw], "rho": [_num(r["rho_ohm_m"]) for r in sw],
                           "W": [_num(r.get("do_am_pct")) for r in sw]} if sw else None,
            "press": {"sigma": [_num(r["ung_suat_mpa"]) for r in pr], "rho": [_num(r["rho_ohm_m"]) for r in pr],
                      "T": [_num(r["nhiet_do_c"]) for r in pr],
                      "cycle": [f"{r['lan_ep']}-{r['chu_ky']}" for r in pr],
                      "W": [_num(r.get("do_am_pct")) for r in pr]} if pr else None,
            "install": ins[-1] if ins else None,
            "checks": chk,
        }
    return out

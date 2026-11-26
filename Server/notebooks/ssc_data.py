"""Đọc dữ liệu SSC vào pandas để thử mô hình AI / deep learning.

Trong Jupyter (docker compose --profile ai up -d), biến môi trường SSC_DB đã có sẵn.
Chạy trên máy chủ ngoài Docker: SSC_DB=postgresql://ssc:<mật khẩu>@localhost:5432/ssc

    from ssc_data import sensors, samples, calib_steps
    df = samples("SSC-001", "2026-11-26 14:00", "2026-11-26 15:00", resolution="1s")
"""
import os

import pandas as pd
from sqlalchemy import create_engine, text

_engine = None


def engine():
    global _engine
    if _engine is None:
        url = os.environ.get("SSC_DB", "postgresql://ssc:ssc@localhost:5432/ssc")
        _engine = create_engine(url.replace("postgresql://", "postgresql+psycopg2://", 1))
    return _engine


def sensors() -> pd.DataFrame:
    """Danh sách cục kèm mô hình hiệu chuẩn đang dùng."""
    q = """SELECT s.*, m.k, m.rho0 AS rho0_cal, m.kind AS model_kind, m.r2
           FROM sensors s LEFT JOIN calib_models m ON m.sensor_id = s.id AND m.active ORDER BY s.code"""
    return pd.read_sql(q, engine())


def samples(code: str, start, end, resolution: str = "raw") -> pd.DataFrame:
    """Chuỗi đo của một cục. resolution: raw (100 mẫu/s), 1s, 1m."""
    cols = "us, up, rs, rho, stress, temp, rh"
    if resolution == "raw":
        q = f"SELECT time, {cols} FROM samples WHERE sensor_id = (SELECT id FROM sensors WHERE code = :c) AND time >= :a AND time < :b ORDER BY time"
    else:
        b = "1 second" if resolution == "1s" else "1 minute"
        agg = ", ".join(f"avg({c.strip()}) AS {c.strip()}" for c in cols.split(","))
        q = f"""SELECT date_bin('{b}', time, TIMESTAMPTZ '2000-01-01') AS time, {agg}
                FROM samples WHERE sensor_id = (SELECT id FROM sensors WHERE code = :c) AND time >= :a AND time < :b
                GROUP BY 1 ORDER BY 1"""
    return pd.read_sql(text(q), engine(), params={"c": code, "a": start, "b": end}, parse_dates=["time"]).set_index("time")


def calib_steps(code: str | None = None) -> pd.DataFrame:
    """Mọi bậc tải đã ghi khi hiệu chuẩn: tập dữ liệu có nhãn (σ thật từ máy nén) để huấn luyện."""
    q = """SELECT s.code, s.mix, r.id AS run_id, st.load_kn, st.stress_mpa, st.rho, st.rho_std, st.temp, st.rh, st.t_from, st.t_to
           FROM calib_steps st JOIN calib_runs r ON r.id = st.run_id JOIN sensors s ON s.id = r.sensor_id"""
    if code:
        q += " WHERE s.code = :c"
    return pd.read_sql(text(q + " ORDER BY st.id"), engine(), params={"c": code} if code else {})

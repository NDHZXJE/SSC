-- SSC database schema. Runs at API startup; every statement is idempotent.

CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL,
    pw_hash     TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One SSC block (cục bê tông tự cảm biến)
CREATE TABLE IF NOT EXISTS sensors (
    id                  SERIAL PRIMARY KEY,
    code                TEXT UNIQUE NOT NULL,          -- mã in QR trên cục
    name                TEXT NOT NULL DEFAULT '',
    mix                 TEXT NOT NULL DEFAULT 'F2',    -- F2 | F1P1 | khác
    electrode_area_mm2  DOUBLE PRECISION NOT NULL DEFAULT 2000,  -- A
    electrode_gap_mm    DOUBLE PRECISION NOT NULL DEFAULT 30,    -- L
    load_area_mm2       DOUBLE PRECISION NOT NULL DEFAULT 2500,  -- Ac (diện tích chịu nén)
    rho0_ref            DOUBLE PRECISION,              -- ρs0(0) tại 20 °C, W = 0 (Ω·m)
    moisture_pct        DOUBLE PRECISION NOT NULL DEFAULT 0,     -- W dùng cho bù (khi chưa có cảm biến)
    location            TEXT NOT NULL DEFAULT '',
    cast_date           DATE,
    note                TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One IoT node. 1 board = 1 SSC block.
CREATE TABLE IF NOT EXISTS devices (
    id          TEXT PRIMARY KEY,                       -- vd: ssc-a1b2c3 (theo MAC)
    sensor_id   INTEGER UNIQUE REFERENCES sensors(id) ON DELETE SET NULL,
    rr_ohm      DOUBLE PRECISION NOT NULL DEFAULT 820,  -- điện trở tham chiếu R1 đo thực
    fw          TEXT NOT NULL DEFAULT '',
    ip          TEXT NOT NULL DEFAULT '',
    rssi        INTEGER,
    last_seen   TIMESTAMPTZ,
    config      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Ghép mạch bằng mã 6 số: node chưa ghép gửi "pair" trong gói status, quản trị nhập mã đó trên web.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS paired BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS pair_code TEXT;
UPDATE devices SET paired = true WHERE sensor_id IS NOT NULL AND NOT paired;  -- node đã gán cục từ trước coi như đã ghép

-- Raw samples, 100 per second per sensor
CREATE TABLE IF NOT EXISTS samples (
    time        TIMESTAMPTZ NOT NULL,
    sensor_id   INTEGER NOT NULL,
    us          REAL,       -- điện áp hai đầu SSC (V)
    up          REAL,       -- điện áp nguồn (V)
    rs          REAL,       -- điện trở SSC (Ω)
    rho         REAL,       -- điện trở suất (Ω·m)
    stress      REAL,       -- ứng suất ước tính (MPa), NULL nếu chưa hiệu chuẩn
    temp        REAL,       -- °C
    rh          REAL        -- % độ ẩm không khí quanh cục
);
CREATE INDEX IF NOT EXISTS samples_sensor_time ON samples (sensor_id, time DESC);

CREATE TABLE IF NOT EXISTS calib_runs (
    id          SERIAL PRIMARY KEY,
    sensor_id   INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    note        TEXT NOT NULL DEFAULT '',
    created_by  TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    status      TEXT NOT NULL DEFAULT 'open'   -- open | fitted
);

CREATE TABLE IF NOT EXISTS calib_steps (
    id          SERIAL PRIMARY KEY,
    run_id      INTEGER NOT NULL REFERENCES calib_runs(id) ON DELETE CASCADE,
    load_kn     DOUBLE PRECISION NOT NULL,
    stress_mpa  DOUBLE PRECISION NOT NULL,
    rho         DOUBLE PRECISION NOT NULL,
    rho_std     DOUBLE PRECISION,
    rs          DOUBLE PRECISION,
    temp        DOUBLE PRECISION,
    rh          DOUBLE PRECISION,
    n_samples   INTEGER NOT NULL,
    t_from      TIMESTAMPTZ NOT NULL,
    t_to        TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Versioned per-sensor calibration models
CREATE TABLE IF NOT EXISTS calib_models (
    id          SERIAL PRIMARY KEY,
    sensor_id   INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    run_id      INTEGER REFERENCES calib_runs(id) ON DELETE SET NULL,
    kind        TEXT NOT NULL DEFAULT 'linear',  -- linear | eq14 | ml
    k           DOUBLE PRECISION,       -- Ω·m / MPa
    rho0        DOUBLE PRECISION,       -- ρs(0) lúc hiệu chuẩn
    rho0_ref    DOUBLE PRECISION,       -- quy về 20 °C, W = 0
    temp        DOUBLE PRECISION,
    moisture    DOUBLE PRECISION,
    r2          DOUBLE PRECISION,
    rmse_mpa    DOUBLE PRECISION,
    params      JSONB NOT NULL DEFAULT '{}'::jsonb,
    active      BOOLEAN NOT NULL DEFAULT false,
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS calib_one_active ON calib_models (sensor_id) WHERE active;

-- ---------------------------------------------------------------- mô hình AI lai (hybrid.py)
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS batch TEXT NOT NULL DEFAULT '';           -- mẻ đúc
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS fc_mpa DOUBLE PRECISION;                  -- cường độ nén
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS is_reference BOOLEAN NOT NULL DEFAULT false;  -- cục đối chứng không tải
ALTER TABLE sensors ADD COLUMN IF NOT EXISTS reference_sensor_id INTEGER REFERENCES sensors(id) ON DELETE SET NULL;
ALTER TABLE samples ADD COLUMN IF NOT EXISTS stress_lo REAL;   -- cận dưới 95% (MPa)
ALTER TABLE samples ADD COLUMN IF NOT EXISTS stress_hi REAL;   -- cận trên 95% (MPa)

-- Quét nhiệt không tải (tủ nhiệt)
CREATE TABLE IF NOT EXISTS calib_temp_steps (
    id          SERIAL PRIMARY KEY,
    sensor_id   INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    temp        DOUBLE PRECISION NOT NULL,
    moisture    DOUBLE PRECISION,
    rho         DOUBLE PRECISION NOT NULL,
    rho_std     DOUBLE PRECISION,
    n_samples   INTEGER NOT NULL DEFAULT 0,
    t_from      TIMESTAMPTZ,
    t_to        TIMESTAMPTZ,
    source      TEXT NOT NULL DEFAULT 'live',   -- live | import
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mốc lắp đặt: rho lúc chưa tải tại công trình
CREATE TABLE IF NOT EXISTS install_readings (
    id          SERIAL PRIMARY KEY,
    sensor_id   INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    time        TIMESTAMPTZ NOT NULL DEFAULT now(),
    rho0        DOUBLE PRECISION NOT NULL,
    temp        DOUBLE PRECISION,
    moisture    DOUBLE PRECISION,
    rho_ref     DOUBLE PRECISION,       -- rho cục đối chứng cùng lúc
    source      TEXT NOT NULL DEFAULT 'live',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Kiểm chứng ngoài hiện trường: lúc biết chắc tải
CREATE TABLE IF NOT EXISTS field_checks (
    id          SERIAL PRIMARY KEY,
    sensor_id   INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    time        TIMESTAMPTZ NOT NULL,
    stress_true DOUBLE PRECISION NOT NULL,
    rho         DOUBLE PRECISION NOT NULL,
    temp        DOUBLE PRECISION,
    moisture    DOUBLE PRECISION,
    rho_ref     DOUBLE PRECISION,
    stress_pred DOUBLE PRECISION,
    source      TEXT NOT NULL DEFAULT 'live',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prior theo cấp phối, tính lại từ các cục đã hiệu chuẩn
CREATE TABLE IF NOT EXISTS ai_priors (
    mix         TEXT PRIMARY KEY,
    stats       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Kết quả kiểm tra trôi
CREATE TABLE IF NOT EXISTS drift_events (
    id          SERIAL PRIMARY KEY,
    sensor_id   INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    time        TIMESTAMPTZ NOT NULL DEFAULT now(),
    status      TEXT NOT NULL,          -- ok | check
    flags       JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS drift_events_sensor ON drift_events (sensor_id, time DESC);

-- Bối cảnh thí nghiệm + hội thoại với trợ lý AI, lưu kèm mỗi lần lưu ở trang Nhập dữ liệu
CREATE TABLE IF NOT EXISTS experiment_notes (
    id          BIGSERIAL PRIMARY KEY,
    sheet       TEXT NOT NULL,
    sensor_id   INT REFERENCES sensors(id) ON DELETE SET NULL,
    context     TEXT,
    chat        JSONB,
    n_rows      INT,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

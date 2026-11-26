import logging
import os

import asyncpg

from . import config

log = logging.getLogger("ssc.db")
pool: asyncpg.Pool | None = None
has_timescale = False

TIMESCALE_SETUP = [
    "SELECT create_hypertable('samples', 'time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE, migrate_data => TRUE)",
    "ALTER TABLE samples SET (timescaledb.compress, timescaledb.compress_segmentby = 'sensor_id', timescaledb.compress_orderby = 'time DESC')",
    "SELECT add_compression_policy('samples', INTERVAL '7 days', if_not_exists => TRUE)",
    """CREATE MATERIALIZED VIEW IF NOT EXISTS samples_1s WITH (timescaledb.continuous) AS
       SELECT time_bucket('1 second', time) AS time, sensor_id,
              avg(us) AS us, avg(up) AS up, avg(rs) AS rs, avg(rho) AS rho, avg(stress) AS stress,
              avg(temp) AS temp, avg(rh) AS rh, min(rho) AS rho_min, max(rho) AS rho_max
       FROM samples GROUP BY 1, 2 WITH NO DATA""",
    "SELECT add_continuous_aggregate_policy('samples_1s', start_offset => INTERVAL '1 hour', end_offset => INTERVAL '5 seconds', schedule_interval => INTERVAL '30 seconds', if_not_exists => TRUE)",
    """CREATE MATERIALIZED VIEW IF NOT EXISTS samples_1m WITH (timescaledb.continuous) AS
       SELECT time_bucket('1 minute', time) AS time, sensor_id,
              avg(us) AS us, avg(up) AS up, avg(rs) AS rs, avg(rho) AS rho, avg(stress) AS stress,
              avg(temp) AS temp, avg(rh) AS rh, min(rho) AS rho_min, max(rho) AS rho_max
       FROM samples GROUP BY 1, 2 WITH NO DATA""",
    "SELECT add_continuous_aggregate_policy('samples_1m', start_offset => INTERVAL '1 day', end_offset => INTERVAL '1 minute', schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE)",
]


async def init():
    global pool, has_timescale
    pool = await asyncpg.create_pool(config.DATABASE_URL, min_size=2, max_size=10)
    with open(os.path.join(os.path.dirname(__file__), "schema.sql"), encoding="utf-8") as f:
        schema = f.read()
    async with pool.acquire() as con:
        await con.execute(schema)
        try:
            await con.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
            has_timescale = True
        except Exception as e:  # plain PostgreSQL still works, just without compression/aggregates
            log.warning("TimescaleDB không có sẵn, chạy với PostgreSQL thường: %s", e)
        if has_timescale:
            for stmt in TIMESCALE_SETUP:
                try:
                    await con.execute(stmt)
                except Exception as e:
                    log.warning("Bỏ qua bước Timescale (%s): %s", stmt.split()[0:3], e)
    log.info("DB sẵn sàng (timescale=%s)", has_timescale)


async def close():
    if pool:
        await pool.close()


def bucket_expr(seconds: int) -> str:
    if has_timescale:
        return f"time_bucket('{seconds} seconds', time)"
    return f"date_bin('{seconds} seconds', time, TIMESTAMPTZ '2000-01-01')"

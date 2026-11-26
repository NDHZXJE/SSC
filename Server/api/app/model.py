"""Physics model for self-sensing cementitious material (SSC).

Source: Nguyen M.H. et al., Measurement 281 (2026) 121975.
  Eq. 5   rho = Rs * A / L
  Eq. 11  rho0(T, W) = rho0_ref * exp(1.2*alpha*(T - 20) + 0.9*beta*(W - 0))
  Eq. 12  alpha = -0.001 ln(rho0_ref)^2 + 0.006 ln(rho0_ref) - 0.01
  Eq. 13  beta  = -0.0115 ln(rho0_ref)^2 + 0.03 ln(rho0_ref) + 0.074
  Eq. 14  F2:   K = -0.015 * rho0 + 0.20
  Eq. 15  F1P1: K = -0.018 * rho0 + 1.00
  Linear response below 20% fc: delta_rho = K * sigma
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

T0 = 20.0
W0 = 0.0
EQ_K = {"F2": (-0.015, 0.20), "F1P1": (-0.018, 1.00)}


def rs_from_voltages(us, up, rr_ohm):
    """Two-probe series circuit: Rs = Rr*Us / (Up - Us). Works on scalars or numpy arrays."""
    us = np.asarray(us, dtype=float)
    up = np.asarray(up, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        rs = rr_ohm * us / (up - us)
    return np.where((up - us) > 1e-6, rs, np.nan)


def rho_from_rs(rs, area_mm2, gap_mm):
    return np.asarray(rs, dtype=float) * (area_mm2 * 1e-6) / (gap_mm * 1e-3)


def alpha_beta(rho0_ref: float) -> tuple[float, float]:
    ln = math.log(rho0_ref)
    alpha = -0.001 * ln**2 + 0.006 * ln - 0.01
    beta = -0.0115 * ln**2 + 0.03 * ln + 0.074
    return alpha, beta


def rho0_env(rho0_ref: float, temp_c: float, moisture_pct: float) -> float:
    a, b = alpha_beta(rho0_ref)
    return rho0_ref * math.exp(1.2 * a * (temp_c - T0) + 0.9 * b * (moisture_pct - W0))


def rho0_to_ref(rho0_measured: float, temp_c: float, moisture_pct: float) -> float:
    """Invert Eq. 11 numerically: find rho0_ref so that rho0_env(rho0_ref, T, W) == measured."""
    x = rho0_measured
    for _ in range(50):
        f = rho0_env(x, temp_c, moisture_pct)
        ratio = rho0_measured / f
        x *= ratio
        if abs(ratio - 1) < 1e-10:
            break
    return x


def k_from_rho0(rho0: float, mix: str) -> float | None:
    coef = EQ_K.get(mix.upper())
    if not coef:
        return None
    return coef[0] * rho0 + coef[1]


@dataclass
class ActiveModel:
    """What the ingest path needs to turn rho into stress for one sensor."""
    kind: str
    k: float          # K at calibration conditions (Ω·m/MPa)
    rho0_ref: float   # ρs0(0) at 20 °C, W = 0
    rho0_cal: float   # ρs(0) measured during calibration
    mix: str
    moisture_pct: float

    def baseline(self, temp_c: float | None) -> tuple[float, float]:
        """Unloaded rho and K at the current environment."""
        t = T0 if temp_c is None or math.isnan(temp_c) else temp_c
        r0 = rho0_env(self.rho0_ref, t, self.moisture_pct)
        k_eq_now = k_from_rho0(r0, self.mix)
        k_eq_cal = k_from_rho0(self.rho0_cal, self.mix)
        if self.kind == "eq14" or not k_eq_now or not k_eq_cal or abs(k_eq_cal) < 1e-9:
            k = k_eq_now if self.kind == "eq14" and k_eq_now else self.k
        else:
            # Transfer the measured K to the current environment with the Eq.14/15 trend.
            k = self.k * (k_eq_now / k_eq_cal)
        return r0, k

    def stress(self, rho: np.ndarray, temp_c: float | None) -> np.ndarray:
        r0, k = self.baseline(temp_c)
        if not k:
            return np.full_like(rho, np.nan)
        return (rho - r0) / k


def fit_linear(stress_mpa: np.ndarray, rho: np.ndarray) -> dict:
    """Fit delta_rho = K*sigma + c on calibration steps."""
    stress_mpa = np.asarray(stress_mpa, float)
    rho = np.asarray(rho, float)
    if len(stress_mpa) < 2 or np.ptp(stress_mpa) == 0:
        raise ValueError("Cần ít nhất 2 bậc tải khác nhau")
    zero = np.argmin(np.abs(stress_mpa))
    rho0 = float(rho[zero])
    d = rho - rho0
    k, c = np.polyfit(stress_mpa, d, 1)
    pred = k * stress_mpa + c
    ss_res = float(np.sum((d - pred) ** 2))
    ss_tot = float(np.sum((d - d.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 1.0
    stress_pred = (d - c) / k if k else np.full_like(d, np.nan)
    rmse = float(np.sqrt(np.mean((stress_pred - stress_mpa) ** 2)))
    return {"k": float(k), "intercept": float(c), "rho0": rho0, "r2": r2, "rmse_mpa": rmse}

"""W3 düzeltme kilitleri: ML-01 / I-05 / I-02 / I-01.

Eğitim-çıkarım bar-dayanağı uyumu bu testlerde gelecekte kırılmasın diye
sabitlenir (repo'nun en ölümcül hata sınıfı). 2026-10-14: ML eğitimi bu
uygulamadan kaldırıldı; journal-örnekleme (ML-02/ML-09) testleri eğitimle
birlikte çıkarıldı, çıkarım/artifact testleri korundu.
"""
import joblib
import numpy as np
import pytest

from app import ml_forecast
from app.config import config as cfg
from app.ml_forecast import (TRAINING_BAR_MINUTES, inference_bar_minutes,
                             FEATURE_NAMES, FEATURE_VERSION)


def test_inference_bar_minutes_equals_training():
    """ML-01: çıkarım eğitimle aynı bar dayanağı: 5m."""
    assert inference_bar_minutes() == TRAINING_BAR_MINUTES
    assert TRAINING_BAR_MINUTES == 5


def test_load_model_rejects_mismatched_training_bar(tmp_path, monkeypatch):
    """I-05: training_bar_minutes eşleşmeyen artifact yükleme reddedilir."""
    monkeypatch.setattr(cfg, "ML_MODELS_DIR", str(tmp_path))
    bogus = {"feature_version": FEATURE_VERSION,
             "feature_names": FEATURE_NAMES,
             "training_bar_minutes": 1,
             "symbol_codes": {}, "horizons": {},
             "trained_at": 0.0}
    path = tmp_path / f"upside_{FEATURE_VERSION}.joblib"
    joblib.dump(bogus, path, compress=3)
    ml_forecast._MODEL_CACHE["artifact"] = None
    ml_forecast._MODEL_CACHE["loaded_at"] = 0.0
    assert ml_forecast.load_model(max_age_seconds=0) is None


def test_load_model_accepts_legacy_artifact_without_training_bar(tmp_path, monkeypatch):
    """I-05 geriye uyumluluk: W3 öncesi artifact'ta training_bar_minutes YOK →
    yüklenir (üretim regresyonu: mevcut upside_v3.joblib silinmeden çalışmalı)."""
    monkeypatch.setattr(cfg, "ML_MODELS_DIR", str(tmp_path))
    legacy = {"feature_version": FEATURE_VERSION,
              "feature_names": FEATURE_NAMES,
              "symbol_codes": {}, "horizons": {},
              "trained_at": 0.0}  # training_bar_minutes alanı yok
    path = tmp_path / f"upside_{FEATURE_VERSION}.joblib"
    joblib.dump(legacy, path, compress=3)
    ml_forecast._MODEL_CACHE["artifact"] = None
    ml_forecast._MODEL_CACHE["loaded_at"] = 0.0
    assert ml_forecast.load_model(max_age_seconds=0) is not None


def test_bollinger_width_uses_canonical_ddof0():
    """I-02: _velocity_bollinger_width kanonik ddof=0 (eğitimle aynı)."""
    from app.routers.velocity import _velocity_bollinger_width
    rng = np.random.default_rng(7)
    closes = list(np.cumsum(rng.normal(0.0, 0.01, 30)) + 1.0)
    val = _velocity_bollinger_width(closes)
    k = 20
    m = sum(closes[-k:]) / k
    sd = float(np.std(closes[-k:], ddof=0))
    assert val == pytest.approx(4 * sd / m * 100, rel=1e-9)


def test_regime_expanding_on_fraction_atr():
    """I-01: atr_pct KESİR 0.008 → volatility_expanding (eski %5 eşiği ulaşılamazdı)."""
    from app.market_intelligence import regime_transition_signal
    snap = {"volatility": {"atr_pct": 0.008}, "volatility_indicators": {}, "volume": {}}
    out = regime_transition_signal(snap)
    assert "volatility_expanding" in out["signals"]



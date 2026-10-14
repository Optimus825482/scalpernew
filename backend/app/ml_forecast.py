"""ML fiyat-tahmin modeli: yalnızca ÇIKARIM (inference) ve artifact yönetimi.

2026-10-14 (kullanıcı kararı): bu uygulamada ML EĞİTİMİ yapılmıyor. Eğitim
döngüsü (`run_ml_training`/`ml_training_loop`), `/api/ml/train|predict`
uçları ve eğitim yardımcıları (`train`, `build_symbol_dataset`,
`prepare_journal_samples`) kaldırıldı. Bu modül yalnızca mevcut artifact'ı
(`upside_v4.joblib`) yükleyip `predict_target` ile tek nokta tahmin üretir;
`velocity.py`, `chart_forecast.py`, `llm_chat.py` çıkarımı kullanmaya devam
eder. Artifact eskiyken/bulunamadığında `load_model` None döner ve çağıranlar
ML özelliğini sessizce devre dışı bırakır (fail-open).
"""
from __future__ import annotations

from datetime import datetime, timezone
import logging
import os
import time
from typing import Any

import numpy as np

from .config import config

logger = logging.getLogger("scalper.ml")

FEATURE_VERSION = "v4"  # v4 (P1-9): regressor etiketi DEĞİŞTİ — "gelecek max
                        #     high" (MFE) yerine GERÇEKLEŞTİRİLEBİLİR ÇIKIŞ
                        #     (ufuk sonu kapanış getirisi); classifier'a
                        #     class_weight="balanced" eklendi. v3 artefaktları
                        #     artık yüklenmez; yeniden eğitim gerekir.
                        #     (v3: göstergeler kanonik kaynakla birleştirildi —
                        #      Wilder RSI, Aroon-25, kanonik linreg_slope10_pct.)
HORIZONS = (5, 15)
# ML-01 (2026-09-12): eğitim ve çıkarım AYNI bar dayanağını kullanmalıdır.
# Model 5m kapanış barlarıyla eğitilir; çıkarım da 5m kapanış barlardan
# özellik üretmelidir. Aksi halde aynı isimli özellik (ret3_pct, atr_pct,
# rsi14, aroon25) farklı anlama gelir ve model eğitim dağılımının dışında
# bir noktada çalışır.
TRAINING_BAR_MINUTES = 5


def inference_bar_minutes() -> int:
    """Çıkarımın kullanması gereken bar dakikası — eğitimle birebir.

    Çağıranlar (velocity, chart_forecast, llm_chat) eğitimle uyumlu kalmak
    için 5m kapanış barlarından özellik üretirken bu fonksiyonu kullanmalıdır.
    """
    return TRAINING_BAR_MINUTES
FEATURE_NAMES = [
    "ret1_pct", "ret3_pct", "ret5_pct", "atr_pct", "bb_width_pct", "rsi14",
    "mfi14", "vol_z", "linreg_slope10_pct", "aroon_up25", "aroon_down25",
    "hour", "day_quarter", "velocity_proxy", "symbol_code",
]

# ---------------------------------------------------------------------------
# Feature-unit contract (tek kaynak — eğitim ve çıkarım AYNI birimi görmeli):
#   TÜM ``*_pct`` girdi alanları YÜZDE'dir (2.0 = %2). predict_target ve
#   prepare_journal_samples bunları içeride KESİRE çevirir (2.0 -> 0.02) ve
#   satıra kesir olarak yazar; build_symbol_dataset ise aynı sonucu doğrudan
#   ham fiyat dizilerinden üretir. Ayrıca rsi/mfi/aroon 0..100 ölçeğindedir.
#
# Gösterge tanım sözleşmesi (2026-09-10): eğitimdeki vektörel hesaplar ile
# çıkarımdaki skaler hesaplar AYNI tanımı kullanmalıdır. Kanonik skaler
# kaynak ``technical_analysis`` (``_rsi`` Wilder, ``_aroon`` periyot 25,
# ``_linreg_slope_pct`` periyot 10). Buradaki vektörel eşlenikler
# ``tests/test_ml_feature_parity.py`` ile birebir eşleşmeye zorlanır.
# ---------------------------------------------------------------------------
def _ratio_from_pct(value) -> float | None:
    """None/NaN güvenli yüzde→kesir dönüşümü (sözleşme: girdi YÜZDE)."""
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(numeric):
        return None
    return numeric / 100.0


def velocity_proxy_value(atr_ratio: float | None, ret3_ratio: float | None) -> float:
    """Paylaşılan hız vekili: ATR oranı × 100 × (1 + 3-bar getiri oranı).

    build_symbol_dataset'teki ``atr_pct * 100 * (1 + ret3)`` ile birebir aynı
    tanım; eğitim/çıkarım arasında özellik kaymasını önler.
    """
    try:
        atr = float(atr_ratio) if atr_ratio is not None and np.isfinite(float(atr_ratio)) else 0.0
        ret3 = float(ret3_ratio) if ret3_ratio is not None and np.isfinite(float(ret3_ratio)) else 0.0
    except (TypeError, ValueError):
        return 0.0
    return atr * 100.0 * (1.0 + ret3)


def atr_ratio_from_bars(highs, lows, closes, period: int = 14) -> float | None:
    """Kanonik ATR ORANI (atr / fiyat) — eğitim ve çıkarım AYNI pencereyi kullanır.

    ML-04 (2026-09-12): `build_symbol_dataset` son ``period`` (14) true-range'in
    basit ortalamasını kullanır. velocity 15, chart_forecast ise 14 elemanla
    hesaplıyordu → aynı isimli özellik üç farklı tanım (ölçülen medyan oran
    0.9928, aralık 0.9439–1.0978). Tek tanım burasıdır.

    Dönen değer KESİRdİr; ``*_pct`` bekleyen çağıranlar ×100 uygular.
    """
    try:
        size = min(len(highs), len(lows), len(closes))
    except TypeError:
        return None
    if size < period + 1:
        return None
    price = float(closes[-1])
    if not price:
        return None
    ranges = []
    for index in range(size - period, size):
        high = float(highs[index]); low = float(lows[index]); prev = float(closes[index - 1])
        ranges.append(max(high - low, abs(high - prev), abs(low - prev)))
    if not ranges:
        return None
    return (sum(ranges) / len(ranges)) / price


def bb_width_ratio_from_bars(closes, period: int = 20) -> float | None:
    """Kanonik Bollinger GENİŞLİK ORANI — eğitimdeki ``4·std(ddof=0)/close[t]``.

    ML-03 (2026-09-12): eğitim ``4·std(ddof=0)/close[t]`` kullanır. velocity
    kopyası ddof=1 VE payda ``mean20`` idi (ölçülen sistematik sapma +%2.6).
    ddof W3'te düzeltildi; payda bu yardımcıyla tekilleştirilir. Dönen değer
    KESİRdİr; ``*_pct`` bekleyen çağıranlar ×100 uygular.
    """
    values = np.asarray(closes, dtype=np.float64)
    if len(values) < period:
        return None
    close_now = float(values[-1])
    if not close_now:
        return None
    window = values[-period:]
    return (4.0 * float(window.std())) / close_now


# ML-06: `stamp` = (mtime, size). Disk üzerindeki artifact yenilendiğinde
# cache anahtarı değişir; eski davranışta yalnız `loaded_at` bakıldığı için
# yeni model 24 saate kadar görülmüyordu.
_MODEL_CACHE: dict[str, Any] = {"artifact": None, "loaded_at": 0.0, "stamp": None}


def load_model(max_age_seconds: int = 86400) -> dict[str, Any] | None:
    """Scout/gölge mod için artifact yükler; 24 saatten geçse de yeniden okur.

    I-05 (2026-09-12): artifact'ın `feature_version` ve `feature_names`i
    FEATURE_VERSION / FEATURE_NAMES ile birebir eşleşmeyen yükleme reddedilir;
    ayrıca (I-04 follow-up) `training_bar_minutes` = TRAINING_BAR_MINUTES
    doğrulanır. Aksi halde predict_target kolonları anlamsız sırada kurar ve
    model "sayı üretmeye devam eder". Uyuşmazlıkta `None` döner + hata loglar.

    Geriye uyumluluk (2026-09-12 üretim regresyonu): W3 öncesi üretilmiş
    artifact'larda `training_bar_minutes` alanı YOKTUR. Bu alan yoksa (None)
    eski artifact'lar da zaten 5m kapanmış barlarla eğitildiği için kabul
    edilir; yalnızca alan MEVCUT ve farklıysa reddedilir. Böylece mevcut
    üretim artifact'ı (upside_v3.joblib) silinip yeniden eğitilmeden çalışır.
    """
    import joblib
    now = time.time()
    path = os.path.join(config.ML_MODELS_DIR, f"upside_{FEATURE_VERSION}.joblib")
    # ML-06: cache anahtarına dosya kimliği (mtime + boyut) katılır. Ölçüm:
    # artifact diske yeniden yazıldıktan sonra `load_model()` AYNI nesneyi
    # döndürüyordu (`a1 is a2 == True`) — 12 saatlik eğitim döngüsü varken
    # çıkarım 24 saate kadar eski modeli kullanabiliyordu.
    try:
        stamp = (os.path.getmtime(path), os.path.getsize(path))
    except OSError:
        stamp = None
    if (_MODEL_CACHE["artifact"] is not None
            and _MODEL_CACHE.get("stamp") == stamp
            and now - _MODEL_CACHE["loaded_at"] < max_age_seconds):
        return _MODEL_CACHE["artifact"]
    if not os.path.exists(path):
        return None
    artifact = joblib.load(path)
    training_bars = artifact.get("training_bar_minutes")
    training_ok = training_bars is None or int(training_bars) == TRAINING_BAR_MINUTES
    if artifact.get("feature_version") != FEATURE_VERSION \
            or artifact.get("feature_names") != FEATURE_NAMES \
            or not training_ok:
        logger.error("[ML] artifact uyumsuz (I-05): %s; feature_version=%r feature_names=%r training=%r",
                     path, artifact.get("feature_version"), artifact.get("feature_names"),
                     artifact.get("training_bar_minutes"))
        _MODEL_CACHE["artifact"] = None
        _MODEL_CACHE["stamp"] = stamp
        return None
    _MODEL_CACHE["artifact"] = artifact
    _MODEL_CACHE["loaded_at"] = now
    _MODEL_CACHE["stamp"] = stamp
    return _MODEL_CACHE["artifact"]


def predict_target(symbol: str, features: dict[str, Any], horizon: int = 5) -> dict[str, Any] | None:
    """Tek nokta tahmin (Faz 2 gölge modda kullanılacak).

    Dönen ``target_pct`` (P1-9): regressor artık GERÇEKLEŞTİRİLEBİLİR çıkış
    dağılımının ``ML_TARGET_QUANTILE`` çeyreğidir — "ufuk sonunda kapanıştan
    çık" kuralının beklenen getirisi. Eskiden "gelecek maksimum high" (MFE,
    ulaşılamaz tepe) servis ediliyordu; bu değer velocity'de TP hedefine
    girdiği için hedef sistematik olarak fazla yüksekti. ``hit_probability``
    "hedefe dokunma" olasılığıdır (classifier, artık class_weight="balanced").
    """
    artifact = load_model()
    if not artifact or str(horizon) not in artifact["horizons"]:
        return None
    sym = str(symbol).upper()
    if sym not in artifact["symbol_codes"]:
        return None
    ts = features.get("timestamp") or features.get("ts") or features.get("last_closed_at_ms")
    if isinstance(ts, (int, float)):
        if ts < 1e11:
            ts = ts * 1000
    elif hasattr(ts, "timestamp"):
        ts = ts.timestamp() * 1000
    else:
        ts = time.time() * 1000
    # ML-05 (2026-09-12): zorunlu özellik kapısı. Eskiden yalnız artifact/
    # sembol kontrolü vardı; özelliklerin TAMAMI None olsa bile satır kurulup
    # model HER ZAMAN bir sayı üretiyordu (ölçüm: `predict_target(sym, {})` ->
    # target_pct=6.036, hit_probability=0.9987). Bu değer
    # `dynamic_target_pct` üzerinden hedefe ve TP'ye giriyordu.
    required = ("atr_pct", "ret3_pct", "rsi")
    if not all(features.get(key) is not None for key in required):
        logger.warning("[ML] predict_target zorunlu özellikler eksik: %s %s", sym,
                       [key for key in required if features.get(key) is None])
        return None
    hour = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).hour
    hour = (hour + 3) % 24
    day_quarter = hour // 6
    # Sözleşme: girdideki TÜM *_pct alanları YÜZDE; satıra kesir olarak yazılır.
    # velocity_proxy paylaşılan tanımdan geçer (eğitimdeki ölçekle aynı).
    atr_ratio = _ratio_from_pct(features.get("atr_pct"))
    ret3_ratio = _ratio_from_pct(features.get("ret3_pct"))
    vp = velocity_proxy_value(atr_ratio, ret3_ratio)
    row = [
        _ratio_from_pct(features.get("ret1_pct")),
        ret3_ratio,
        _ratio_from_pct(features.get("ret5_pct")),
        # ML-08: `atr_ratio` None ise 0.0 UYDURMA — eğitimde bu hücre NaN'dır.
        atr_ratio,
        _ratio_from_pct(features.get("bb_width_pct")),
        # ML-08: `vol_z` önceden sabit None yazılıyordu; eğitimde GERÇEK değer
        # hesaplandığı için model bu kolona dayanmayı öğrenirse çıkarımda
        # körleşiyordu. Artık çağıranın verdiği değer geçirilir.
        features.get("rsi"), features.get("mfi"), features.get("vol_z"),
        _ratio_from_pct(features.get("linreg_slope10_pct")),
        features.get("aroon_up"), features.get("aroon_down"),
        float(hour), float(day_quarter), float(vp),
        float(artifact["symbol_codes"][sym]),
    ]
    X = np.asarray([row], dtype=np.float32)
    bundle = artifact["horizons"][str(horizon)]
    return {"target_pct": round(float(bundle["reg"].predict(X)[0]) * 100, 3),
            "hit_probability": round(float(bundle["clf"].predict_proba(X)[0][1]), 4),
            "quantile": config.ML_TARGET_QUANTILE, "trained_at": artifact["trained_at"]}

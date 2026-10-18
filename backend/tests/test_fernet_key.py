"""Binance anahtarı, bozuk Fernet ortam değişkeninde de şifrelenip açılabilsin."""
import os
import unittest
from unittest import mock

from cryptography.fernet import Fernet

from app import llm_analysis


class FernetKeyTests(unittest.TestCase):
    def tearDown(self):
        llm_analysis._DERIVED_FERNET_WARNED.clear()

    def test_valid_key_roundtrip(self):
        key = Fernet.generate_key().decode()
        with mock.patch.dict(os.environ, {"LLM_ENCRYPTION_KEY": key}, clear=False):
            token = llm_analysis.encrypt_key("gizli")
            self.assertEqual(llm_analysis.decrypt_key(token), "gizli")

    def test_quoted_and_unpadded_key_matches_original(self):
        key = Fernet.generate_key().decode()
        unpadded = key.rstrip("=")
        with mock.patch.dict(os.environ, {"LLM_ENCRYPTION_KEY": f'  "{unpadded}"  '}, clear=False):
            token = llm_analysis.encrypt_key("gizli", primary_env="LLM_ENCRYPTION_KEY")
            self.assertEqual(Fernet(key.encode()).decrypt(token.encode()).decode(), "gizli")

    def test_invalid_secret_is_stable(self):
        env = {
            "BINANCE_ENCRYPTION_KEY": "",
            "LLM_ENCRYPTION_KEY": "bu-gecerli-fernet-degil",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            token = llm_analysis.encrypt_key(
                "api-secret",
                primary_env="BINANCE_ENCRYPTION_KEY",
                fallback_env="LLM_ENCRYPTION_KEY",
            )
            opened = llm_analysis.decrypt_key(
                token,
                primary_env="BINANCE_ENCRYPTION_KEY",
                fallback_env="LLM_ENCRYPTION_KEY",
            )
            self.assertEqual(opened, "api-secret")

    def test_valid_fallback_beats_invalid_primary(self):
        good = Fernet.generate_key().decode()
        env = {"BINANCE_ENCRYPTION_KEY": "bozuk", "LLM_ENCRYPTION_KEY": good}
        with mock.patch.dict(os.environ, env, clear=False):
            token = llm_analysis.encrypt_key(
                "api-secret",
                primary_env="BINANCE_ENCRYPTION_KEY",
                fallback_env="LLM_ENCRYPTION_KEY",
            )
            self.assertEqual(Fernet(good.encode()).decrypt(token.encode()).decode(), "api-secret")
            self.assertEqual(
                llm_analysis.decrypt_key(
                    token,
                    primary_env="BINANCE_ENCRYPTION_KEY",
                    fallback_env="LLM_ENCRYPTION_KEY",
                ),
                "api-secret",
            )

    def test_empty_env_raises(self):
        env = {"LLM_ENCRYPTION_KEY": "   ", "BINANCE_ENCRYPTION_KEY": ""}
        with mock.patch.dict(os.environ, env, clear=False):
            with self.assertRaises(RuntimeError):
                llm_analysis.encrypt_key("x", primary_env="BINANCE_ENCRYPTION_KEY", fallback_env="LLM_ENCRYPTION_KEY")


if __name__ == "__main__":
    unittest.main()

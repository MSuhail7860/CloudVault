#!/usr/bin/env python3
"""Focused test suite for production configuration and Compose validator.

Tests fail-closed requirements for DATABASE_URL and DATABASE_URL_UNPOOLED,
Compose service topologies, security policies, and regression safeguards.
Uses synthetic placeholder credentials only.
"""

import importlib.util
import os
import stat
import tempfile
import unittest
from unittest import mock
from pathlib import Path

# Dynamically import production-config-check.py
SCRIPT_DIR = Path(__file__).resolve().parent
VALIDATOR_PATH = SCRIPT_DIR / "production-config-check.py"
spec = importlib.util.spec_from_file_location("production_config_check", VALIDATOR_PATH)
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class ProductionConfigValidatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.work_dir = Path(self.temp_dir.name)

        # Baseline synthetic environment definitions
        self.synthetic_env: dict[str, str] = {
            "NODE_ENV": "production",
            "ALLOW_TEST_CLIENT_ISOLATION": "false",
            "TRUST_PROXY_HOPS": "2",
            "FRONTEND_URL": "https://vault.domain.org",
            "FRONTEND_HOST_PORT": "38081",
            "EMAIL_PROVIDER": "resend",
            "EMAIL_FROM": "CloudVault <notifications@domain.org>",
            "RESEND_API_KEY": "re_synthetic_test_key_998877665544332211",
            "DATABASE_URL": "postgresql://vault_app:StrongSynthPass_App99@db-pool.domain.org:5432/vault_prod?sslmode=verify-full",
            "DATABASE_URL_UNPOOLED": "postgresql://vault_migrator:StrongSynthPass_Migr99@db-direct.domain.org:5432/vault_prod?sslmode=verify-full",
            "JWT_ACCESS_SECRET": "synthetic-access-token-secret-minimum-32-chars-long",
            "JWT_REFRESH_SECRET": "synthetic-refresh-token-secret-minimum-32-chars-long",
            "REDIS_ENABLED": "true",
            "REDIS_URL": "rediss://:StrongSynthPass_Redis99@redis.domain.org:6380/0",
            "S3_ENDPOINT": "https://storage.domain.org",
            "S3_REGION": "us-east-1",
            "S3_BUCKET": "vault-storage-bucket",
            "S3_ACCESS_KEY_ID": "SYNTHETIC_S3_KEY_ID_123",
            "S3_SECRET_ACCESS_KEY": "SYNTHETIC_S3_SECRET_ACCESS_KEY_XYZ",
        }

        self.compose_file = SCRIPT_DIR / "compose.production.yaml"
        self.nginx_file = SCRIPT_DIR.parents[1] / "Frontend/deploy/docker/nginx.conf"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _write_env_file(self, env_dict: dict[str, str], mode: int = 0o600) -> Path:
        env_path = self.work_dir / f"env-{os.urandom(4).hex()}"
        lines = [f"{k}={v}" for k, v in env_dict.items()]
        env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        os.chmod(env_path, mode)
        return env_path

    def _run_validation(self, env_dict: dict[str, str], compose_path: Path | None = None) -> None:
        env_path = self._write_env_file(env_dict)
        args = mock.Mock()
        args.env_file = str(env_path)
        args.compose_file = str(compose_path or self.compose_file)
        args.nginx_config = str(self.nginx_file)
        validator.validate(args)

    # 1. Valid baseline configuration
    def test_valid_baseline_configuration_passes(self) -> None:
        self._run_validation(self.synthetic_env)

    # 2. Missing unpooled URL
    def test_missing_unpooled_url_fails(self) -> None:
        env = dict(self.synthetic_env)
        del env["DATABASE_URL_UNPOOLED"]
        with self.assertRaises(ValueError) as ctx:
            self._run_validation(env)
        self.assertIn("DATABASE_URL_UNPOOLED", str(ctx.exception))
        self.assertIn("Missing mandatory production setting", str(ctx.exception))

    # 3. Empty unpooled URL
    def test_empty_unpooled_url_fails(self) -> None:
        env = dict(self.synthetic_env)
        env["DATABASE_URL_UNPOOLED"] = "   "
        with self.assertRaises(ValueError) as ctx:
            self._run_validation(env)
        self.assertIn("DATABASE_URL_UNPOOLED", str(ctx.exception))
        self.assertIn("Missing mandatory production setting", str(ctx.exception))

    # 4. Placeholder unpooled URL
    def test_placeholder_unpooled_url_fails(self) -> None:
        for placeholder in ["replace-me", "example.invalid", "changeme", "sample"]:
            env = dict(self.synthetic_env)
            env["DATABASE_URL_UNPOOLED"] = f"postgresql://user:{placeholder}@db.domain.org:5432/vault?sslmode=verify-full"
            with self.assertRaises(ValueError) as ctx:
                self._run_validation(env)
            self.assertIn("contains a placeholder value", str(ctx.exception))

    # 5. Insecure or local unpooled URL
    def test_local_host_unpooled_url_fails(self) -> None:
        for local_host in ["localhost", "127.0.0.1", "postgres"]:
            env = dict(self.synthetic_env)
            env["DATABASE_URL_UNPOOLED"] = f"postgresql://user:validpass@{local_host}:5432/vault?sslmode=verify-full"
            with self.assertRaises(ValueError) as ctx:
                self._run_validation(env)
            self.assertIn("DATABASE_URL_UNPOOLED must target production-compatible PostgreSQL with TLS enabled", str(ctx.exception))

    def test_reserved_suffix_unpooled_url_fails(self) -> None:
        for suffix in [".test", ".invalid", ".example", ".localhost"]:
            env = dict(self.synthetic_env)
            env["DATABASE_URL_UNPOOLED"] = f"postgresql://user:validpass@db{suffix}:5432/vault?sslmode=verify-full"
            with self.assertRaises(ValueError) as ctx:
                self._run_validation(env)
            self.assertTrue(
                "contains a placeholder value" in str(ctx.exception)
                or "DATABASE_URL_UNPOOLED must target production-compatible PostgreSQL with TLS enabled" in str(ctx.exception)
            )

    def test_missing_tls_unpooled_url_fails(self) -> None:
        for query in ["", "?sslmode=disable", "?sslmode=prefer"]:
            env = dict(self.synthetic_env)
            env["DATABASE_URL_UNPOOLED"] = f"postgresql://user:validpass@db-direct.domain.org:5432/vault{query}"
            with self.assertRaises(ValueError) as ctx:
                self._run_validation(env)
            self.assertIn("DATABASE_URL_UNPOOLED must target production-compatible PostgreSQL with TLS enabled", str(ctx.exception))

    def test_non_postgresql_scheme_unpooled_url_fails(self) -> None:
        env = dict(self.synthetic_env)
        env["DATABASE_URL_UNPOOLED"] = "mysql://user:validpass@db-direct.domain.org:3306/vault?sslmode=verify-full"
        with self.assertRaises(ValueError) as ctx:
            self._run_validation(env)
        self.assertIn("DATABASE_URL_UNPOOLED must be a PostgreSQL connection URL", str(ctx.exception))

    # 6. Existing pooled URL validation
    def test_missing_pooled_url_fails(self) -> None:
        env = dict(self.synthetic_env)
        del env["DATABASE_URL"]
        with self.assertRaises(ValueError) as ctx:
            self._run_validation(env)
        self.assertIn("DATABASE_URL", str(ctx.exception))

    def test_insecure_pooled_url_fails(self) -> None:
        env = dict(self.synthetic_env)
        env["DATABASE_URL"] = "postgresql://user:validpass@127.0.0.1:5432/vault?sslmode=disable"
        with self.assertRaises(ValueError) as ctx:
            self._run_validation(env)
        self.assertIn("DATABASE_URL must target production-compatible PostgreSQL with TLS enabled", str(ctx.exception))

    # 7. Compose structure validation & fail-closed migrations
    def test_compose_migration_fallback_rejected(self) -> None:
        compose_content = self.compose_file.read_text(encoding="utf-8")
        # Replace the hardened expression with the legacy fallback
        bad_compose = compose_content.replace(
            'DATABASE_URL: "${DATABASE_URL_UNPOOLED:?DATABASE_URL_UNPOOLED is required for migrations}"',
            'DATABASE_URL: "${DATABASE_URL_UNPOOLED:-$DATABASE_URL}"'
        )
        bad_compose_path = self.work_dir / "compose.bad.yaml"
        bad_compose_path.write_text(bad_compose, encoding="utf-8")

        with self.assertRaises(ValueError) as ctx:
            self._run_validation(self.synthetic_env, compose_path=bad_compose_path)
        self.assertIn("Production migration service must require DATABASE_URL_UNPOOLED", str(ctx.exception))

    def test_compose_missing_migrate_service_rejected(self) -> None:
        compose_content = self.compose_file.read_text(encoding="utf-8")
        # Remove migrate service
        bad_compose = compose_content.replace("migrate:", "old_migrate:")
        bad_compose_path = self.work_dir / "compose.no_migrate.yaml"
        bad_compose_path.write_text(bad_compose, encoding="utf-8")

        with self.assertRaises(ValueError) as ctx:
            self._run_validation(self.synthetic_env, compose_path=bad_compose_path)
        self.assertIn("Production Compose config must define the migrate service", str(ctx.exception))

    # 8. Safeguard regression tests
    def test_insecure_file_permissions_rejected(self) -> None:
        env_path = self._write_env_file(self.synthetic_env, mode=0o644)
        args = mock.Mock()
        args.env_file = str(env_path)
        args.compose_file = str(self.compose_file)
        args.nginx_config = str(self.nginx_file)
        with self.assertRaises(ValueError) as ctx:
            validator.validate(args)
        self.assertIn("must not be readable or writable by group/other", str(ctx.exception))

    def test_non_production_node_env_rejected(self) -> None:
        env = dict(self.synthetic_env)
        env["NODE_ENV"] = "development"
        with self.assertRaises(ValueError) as ctx:
            self._run_validation(env)
        self.assertIn("NODE_ENV must be production", str(ctx.exception))

    def test_test_client_isolation_enabled_rejected(self) -> None:
        env = dict(self.synthetic_env)
        env["ALLOW_TEST_CLIENT_ISOLATION"] = "true"
        with self.assertRaises(ValueError) as ctx:
            self._run_validation(env)
        self.assertIn("ALLOW_TEST_CLIENT_ISOLATION must be disabled", str(ctx.exception))

    def test_jwt_secrets_too_short_or_identical_rejected(self) -> None:
        env = dict(self.synthetic_env)
        env["JWT_ACCESS_SECRET"] = "short"
        with self.assertRaises(ValueError) as ctx:
            self._run_validation(env)
        self.assertIn("JWT secrets must be distinct and contain at least 32 characters each", str(ctx.exception))

        env["JWT_ACCESS_SECRET"] = "identical-secret-value-longer-than-32-chars-long"
        env["JWT_REFRESH_SECRET"] = "identical-secret-value-longer-than-32-chars-long"
        with self.assertRaises(ValueError) as ctx:
            self._run_validation(env)
        self.assertIn("JWT secrets must be distinct and contain at least 32 characters each", str(ctx.exception))

    def test_insecure_redis_url_rejected(self) -> None:
        env = dict(self.synthetic_env)
        env["REDIS_URL"] = "redis://127.0.0.1:6379"  # non-TLS, localhost, no auth
        with self.assertRaises(ValueError) as ctx:
            self._run_validation(env)
        self.assertIn("REDIS_URL must use TLS, authentication, and a non-local production endpoint", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()

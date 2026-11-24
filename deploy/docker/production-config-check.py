#!/usr/bin/env python3
"""Fail-closed structural and value validation for the production Compose config."""

import argparse
import re
import stat
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


PLACEHOLDER_TERMS = (
    "replace-",
    "change-me",
    "example.invalid",
    "placeholder",
    "your-",
    "changeme",
    "fixture",
    "dummy",
    "sample",
)
PLACEHOLDER_VALUES = {
    "admin",
    "changeme",
    "default",
    "example",
    "password",
    "postgres",
    "redis",
    "root",
    "secret",
    "test",
    "user",
    "123456",
}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "postgres", "redis", "minio"}
RESERVED_HOST_SUFFIXES = (".test", ".invalid", ".example", ".localhost")


def fail(message: str) -> None:
    raise ValueError(message)


def read_environment(path: Path) -> dict[str, str]:
    if path.is_symlink():
        fail("Production environment file must not be a symbolic link.")
    if not path.is_file():
        fail("Production environment file is missing.")
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        fail("Production environment file must not be readable or writable by group/other users.")
    values: dict[str, str] = {}
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            fail(f"Malformed environment entry at line {line_number}.")
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or key in values:
            fail(f"Invalid or duplicate environment name at line {line_number}.")
        if value[:1] in {"'", '"'}:
            if len(value) < 2 or value[-1] != value[0]:
                fail(f"Malformed quoted environment value at line {line_number}.")
            value = value[1:-1]
        if "$" in value or "\n" in value or "\r" in value:
            fail(f"Environment interpolation is not allowed in production value {key}.")
        values[key] = value
    return values


def required(values: dict[str, str], name: str) -> str:
    value = values.get(name, "").strip()
    if not value:
        fail(f"Missing mandatory production setting: {name}.")
    if (
        any(term in value.lower() for term in PLACEHOLDER_TERMS)
        or value.lower() in PLACEHOLDER_VALUES
    ):
        fail(f"Production setting {name} contains a placeholder value.")
    return value


def public_https_origin(origin: str) -> bool:
    if "*" in origin:
        return False
    parsed = urlsplit(origin)
    return (
        parsed.scheme == "https"
        and bool(parsed.hostname)
        and parsed.hostname.lower() not in LOCAL_HOSTS
        and not parsed.hostname.lower().endswith(RESERVED_HOST_SUFFIXES)
        and not parsed.username
        and not parsed.password
        and parsed.path in {"", "/"}
        and not parsed.query
        and not parsed.fragment
    )


def parse_compose_services(text: str) -> dict[str, str]:
    """Structurally extract Compose services and their definitions from YAML text."""
    top_level_sections: dict[str, list[str]] = {}
    current_section = ""

    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if raw_line[0] not in (" ", "\t") and ":" in raw_line:
            key = raw_line.split(":", 1)[0].strip()
            current_section = key
            top_level_sections[current_section] = []
            continue

        if current_section:
            top_level_sections[current_section].append(raw_line)

    services_lines = top_level_sections.get("services", [])
    services: dict[str, str] = {}
    current_service = ""
    current_service_body: list[str] = []

    service_indent = None
    for line in services_lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            service_indent = len(line) - len(line.lstrip(" "))
            break

    if service_indent is not None:
        for line in services_lines:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            indent = len(line) - len(line.lstrip(" "))
            if indent == service_indent and line.rstrip().endswith(":"):
                if current_service:
                    services[current_service] = "\n".join(current_service_body)
                current_service = stripped[:-1].strip()
                current_service_body = []
            elif current_service:
                current_service_body.append(line)
        if current_service:
            services[current_service] = "\n".join(current_service_body)

    return services


def validate_compose(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    services = parse_compose_services(text)

    if "api" not in services or "worker" not in services:
        fail("Production Compose config must define both API and worker services.")
    if "migrate" not in services:
        fail("Production Compose config must define the migrate service.")
    migrate_body = services.get("migrate", "")
    if not re.search(r'DATABASE_URL:\s*"\$\{DATABASE_URL_UNPOOLED:\?', migrate_body):
        fail("Production migration service must require DATABASE_URL_UNPOOLED.")
    if any(svc in services for svc in ("postgres", "redis", "minio")):
        fail("Production Compose config must not run local PostgreSQL, Redis, or MinIO services.")
    if "NODE_ENV: production" not in text or 'ALLOW_TEST_CLIENT_ISOLATION: "false"' not in text:
        fail("Production Compose must enforce NODE_ENV=production and disable test-client isolation.")

    frontend_body = services.get("frontend", "")
    if not re.search(r'(?m)^\s+- "127\.0\.0\.1:\$\{FRONTEND_HOST_PORT:\?', frontend_body):
        fail("Only the frontend may be published, and it must bind to loopback.")

    for service, body in services.items():
        if re.search(r"(?m)^\s+ports:\s*$", body) and service != "frontend":
            fail(f"Production service {service} must not publish host ports.")

    if "EMAIL_PROVIDER: resend" not in text or "RESEND_API_KEY:" not in text:
        fail("Production Compose must require the real email provider configuration.")
    if "S3_ENDPOINT:" not in text or "S3_SECRET_ACCESS_KEY:" not in text:
        fail("Production Compose must require S3-compatible storage configuration.")


def validate_nginx(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    if not re.search(
        r"(?m)^\s*proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for\s*;",
        text,
    ):
        fail("Frontend Nginx must preserve the sanitized forwarded client-address chain.")
    if not re.search(
        r"(?m)^\s*proxy_set_header\s+X-Forwarded-Proto\s+\$forwarded_proto\s*;",
        text,
    ):
        fail("Frontend Nginx must preserve the trusted external TLS protocol.")
    if not re.search(r"(?m)^map\s+\$http_x_forwarded_proto\s+\$forwarded_proto\s*\{", text):
        fail("Frontend Nginx must define a safe forwarded-protocol fallback.")


def validate(args: argparse.Namespace) -> None:
    values = read_environment(Path(args.env_file))
    validate_compose(Path(args.compose_file))
    validate_nginx(Path(args.nginx_config))

    if required(values, "NODE_ENV") != "production":
        fail("NODE_ENV must be production.")
    if required(values, "ALLOW_TEST_CLIENT_ISOLATION").lower() not in {"false", "0", "no"}:
        fail("ALLOW_TEST_CLIENT_ISOLATION must be disabled.")
    if required(values, "EMAIL_PROVIDER").lower() != "resend":
        fail("EMAIL_PROVIDER must be resend for the configured production mail implementation.")
    if not required(values, "RESEND_API_KEY"):
        fail("RESEND_API_KEY is required.")
    sender = required(values, "EMAIL_FROM")
    sender_match = re.search(r"(?:^|<)([^<>\s]+@[^<>\s]+)>?$", sender)
    if not sender_match:
        fail("EMAIL_FROM must identify a real, verified production sender.")
    sender_domain = sender_match.group(1).rsplit("@", 1)[1].lower()
    if sender_domain.endswith(RESERVED_HOST_SUFFIXES) or "example.com" in sender_domain:
        fail("EMAIL_FROM must use a non-placeholder production sender domain.")

    origins = required(values, "FRONTEND_URL").split(",")
    if (
        not origins
        or len({origin.strip() for origin in origins}) != len(origins)
        or any(not public_https_origin(origin.strip()) for origin in origins)
    ):
        fail("FRONTEND_URL must contain explicit HTTPS origins; wildcard and local origins are forbidden.")

    access_secret = required(values, "JWT_ACCESS_SECRET")
    refresh_secret = required(values, "JWT_REFRESH_SECRET")
    if len(access_secret) < 32 or len(refresh_secret) < 32 or access_secret == refresh_secret:
        fail("JWT secrets must be distinct and contain at least 32 characters each.")

    database_url = urlsplit(required(values, "DATABASE_URL"))
    database_ssl = parse_qs(database_url.query).get("sslmode", [""])[0]
    if (
        database_url.scheme not in {"postgres", "postgresql"}
        or not database_url.hostname
        or not database_url.username
        or not database_url.password
    ):
        fail("DATABASE_URL must be a PostgreSQL connection URL.")
    if (
        database_url.hostname.lower() in LOCAL_HOSTS
        or database_url.hostname.lower().endswith(RESERVED_HOST_SUFFIXES)
        or database_ssl not in {"require", "verify-ca", "verify-full"}
        or database_url.password.lower() in PLACEHOLDER_VALUES
    ):
        fail("DATABASE_URL must target production-compatible PostgreSQL with TLS enabled.")

    unpooled_raw = required(values, "DATABASE_URL_UNPOOLED")
    unpooled_url = urlsplit(unpooled_raw)
    unpooled_ssl = parse_qs(unpooled_url.query).get("sslmode", [""])[0]
    if (
        unpooled_url.scheme not in {"postgres", "postgresql"}
        or not unpooled_url.hostname
        or not unpooled_url.username
        or not unpooled_url.password
    ):
        fail("DATABASE_URL_UNPOOLED must be a PostgreSQL connection URL.")
    if (
        unpooled_url.hostname.lower() in LOCAL_HOSTS
        or unpooled_url.hostname.lower().endswith(RESERVED_HOST_SUFFIXES)
        or unpooled_ssl not in {"require", "verify-ca", "verify-full"}
        or unpooled_url.password.lower() in PLACEHOLDER_VALUES
    ):
        fail("DATABASE_URL_UNPOOLED must target production-compatible PostgreSQL with TLS enabled.")

    redis_url = urlsplit(required(values, "REDIS_URL"))
    if (
        redis_url.scheme != "rediss"
        or not redis_url.hostname
        or redis_url.hostname.lower() in LOCAL_HOSTS
        or redis_url.hostname.lower().endswith(RESERVED_HOST_SUFFIXES)
        or not redis_url.password
        or redis_url.password.lower() in PLACEHOLDER_VALUES
    ):
        fail("REDIS_URL must use TLS, authentication, and a non-local production endpoint.")
    if required(values, "REDIS_ENABLED").lower() not in {"true", "1", "yes"}:
        fail("REDIS_ENABLED must be true for production queue processing.")

    endpoint = urlsplit(required(values, "S3_ENDPOINT"))
    if (
        endpoint.scheme != "https"
        or not endpoint.hostname
        or endpoint.hostname.lower() in LOCAL_HOSTS
        or endpoint.hostname.lower().endswith(RESERVED_HOST_SUFFIXES)
        or endpoint.username
        or endpoint.password
        or endpoint.query
        or endpoint.fragment
    ):
        fail("S3_ENDPOINT must use HTTPS and a non-local production endpoint.")
    required(values, "S3_REGION")
    required(values, "S3_BUCKET")
    required(values, "S3_ACCESS_KEY_ID")
    required(values, "S3_SECRET_ACCESS_KEY")

    try:
        proxy_hops = int(required(values, "TRUST_PROXY_HOPS"))
        port = int(required(values, "FRONTEND_HOST_PORT"))
    except ValueError:
        fail("TRUST_PROXY_HOPS and FRONTEND_HOST_PORT must be integers.")
    if proxy_hops < 2:
        fail("TRUST_PROXY_HOPS must include at least the TLS edge and frontend Nginx.")
    if port < 1024 or port > 65535:
        fail("FRONTEND_HOST_PORT must be an unprivileged TCP port.")

    print("Production configuration structure and required safeguards validated.")
    print("External credentials and service connectivity were not tested by this check.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", required=True)
    parser.add_argument(
        "--compose-file",
        default=str(Path(__file__).with_name("compose.production.yaml")),
    )
    parser.add_argument(
        "--nginx-config",
        default=str(
            Path(__file__).resolve().parents[2]
            / "Frontend/deploy/docker/nginx.conf"
        ),
    )
    args = parser.parse_args()
    try:
        validate(args)
    except (OSError, UnicodeDecodeError, ValueError) as error:
        print(f"[FAIL] {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

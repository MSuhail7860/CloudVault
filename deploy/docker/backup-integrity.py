#!/usr/bin/env python3
"""Create and verify CloudVault backup manifests using only the Python stdlib."""

import argparse
import hashlib
import hmac
import json
import os
import re
import stat
import sys
from pathlib import Path, PurePosixPath


PROJECT = "cloudvault-app-docker"
MANIFEST_NAME = "manifest.json"
OBJECTS_CHECKSUM_NAME = "objects.sha256"
OBJECTS_INVENTORY_NAME = "objects.jsonl"
CHECKSUM_LINE = re.compile(r"^([0-9a-f]{64}) [ *](.+)$")


class VerificationError(Exception):
    pass


class DuplicateManifestKey(VerificationError):
    pass


def fail(message: str) -> None:
    raise VerificationError(message)


def reject_duplicate_manifest_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateManifestKey(f"Duplicate manifest field: {key}.")
        result[key] = value
    return result


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_key(backup_dir: Path) -> bytes | None:
    key_path_value = os.environ.get("BACKUP_HMAC_KEY_FILE", "").strip()
    if not key_path_value:
        return None
    configured_key_path = Path(key_path_value).expanduser()
    if configured_key_path.is_symlink():
        fail("The HMAC key path must not be a symbolic link.")
    key_path = configured_key_path.resolve(strict=True)
    try:
        key_path.relative_to(backup_dir.resolve())
    except ValueError:
        pass
    else:
        fail("The HMAC key file must be stored outside the backup directory.")
    if not key_path.is_file():
        fail("The configured HMAC key path is not a regular file.")
    mode = stat.S_IMODE(key_path.stat().st_mode)
    if mode & 0o077:
        fail("The HMAC key file permissions must deny access to group and other users.")
    key = key_path.read_bytes()
    if len(key) < 32:
        fail("The HMAC key must contain at least 32 bytes.")
    return key


def manifest_payload(manifest: dict) -> bytes:
    unsigned = {key: value for key, value in manifest.items() if key != "authentication"}
    return json.dumps(unsigned, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def object_files(objects_dir: Path) -> list[Path]:
    if objects_dir.is_symlink():
        fail("objects directory must not be a symbolic link.")
    if not objects_dir.is_dir():
        fail("Missing objects directory.")
    files = sorted(objects_dir.rglob("*"))
    if any(path.is_symlink() for path in files):
        fail("Symbolic links are not permitted in backup objects.")
    return [path for path in files if path.is_file()]


def create(args: argparse.Namespace) -> None:
    raw_backup_path = Path(args.backup_dir)
    if raw_backup_path.is_symlink():
        fail("Backup directory must not be a symbolic link.")
    backup_dir = raw_backup_path.resolve(strict=True)
    database_path = backup_dir / "database.sql"
    if database_path.is_symlink():
        fail("database.sql must not be a symbolic link.")
    if not database_path.is_file():
        fail("Missing regular database.sql file.")
    if database_path.stat().st_size == 0:
        fail("database.sql is empty.")

    objects_dir = backup_dir / "objects"
    files = object_files(objects_dir)
    checksum_path = backup_dir / OBJECTS_CHECKSUM_NAME
    inventory_path = backup_dir / OBJECTS_INVENTORY_NAME
    with checksum_path.open("w", encoding="utf-8", newline="\n") as checksums:
        with inventory_path.open("x", encoding="utf-8", newline="\n") as inventory:
            for path in files:
                relative = path.relative_to(objects_dir).as_posix()
                checksum = sha256_file(path)
                size = path.stat().st_size
                checksums.write(f"{checksum}  ./{relative}\n")
                json.dump(
                    {"key": relative, "size": size, "sha256": checksum},
                    inventory,
                    sort_keys=True,
                    separators=(",", ":"),
                )
                inventory.write("\n")

    manifest = {
        "manifestVersion": "3.0",
        "backupTimestamp": args.timestamp,
        "project": args.project,
        "database": {
            "name": args.database_name,
            "user": args.database_user,
            "dumpFile": "database.sql",
            "sha256": sha256_file(database_path),
        },
        "storage": {
            "bucket": args.bucket,
            "directory": "objects",
            "objectCount": len(files),
            "objectsChecksumFile": OBJECTS_CHECKSUM_NAME,
            "objectsManifestSha256": sha256_file(checksum_path),
            "objectsInventoryFile": OBJECTS_INVENTORY_NAME,
            "objectsInventorySha256": sha256_file(inventory_path),
        },
        "integrity": {
            "checksums": "SHA-256 (accidental corruption detection; not authenticated)",
        },
    }

    key = load_key(backup_dir)
    if key is not None:
        manifest["authentication"] = {
            "algorithm": "HMAC-SHA256",
            "hmacSha256": hmac.new(key, manifest_payload(manifest), hashlib.sha256).hexdigest(),
        }

    manifest_path = backup_dir / MANIFEST_NAME
    with manifest_path.open("x", encoding="utf-8") as output:
        json.dump(manifest, output, indent=2, sort_keys=True)
        output.write("\n")

    print(f"Manifest created; {len(files)} storage object(s) recorded.")
    if key is None:
        print("Authentication: checksum-only (not tamper-protected).")
    else:
        print("Authentication: HMAC-SHA256 using an external runtime key.")


def parse_object_checksums(checksum_path: Path, objects_dir: Path) -> dict[str, str]:
    checksums: dict[str, str] = {}
    with checksum_path.open(encoding="utf-8") as source:
        for number, line in enumerate(source, start=1):
            line = line.rstrip("\n")
            match = CHECKSUM_LINE.fullmatch(line)
            if not match:
                fail(f"Malformed object checksum entry at line {number}.")
            checksum, raw_name = match.groups()
            name = raw_name.removeprefix("./")
            path = PurePosixPath(name)
            if path.is_absolute() or not name or any(part in {"", ".", ".."} for part in path.parts):
                fail(f"Unsafe object checksum path at line {number}.")
            normalized = path.as_posix()
            if normalized in checksums:
                fail(f"Duplicate object checksum entry for {normalized}.")
            checksums[normalized] = checksum
    return checksums


def validate_backup_root(backup_dir: Path, manifest_version: str) -> None:
    allowed_files = {
        MANIFEST_NAME,
        "database.sql",
        OBJECTS_CHECKSUM_NAME,
    }
    if manifest_version in {"2.0", "3.0"}:
        allowed_files.add(OBJECTS_CHECKSUM_NAME)
    if manifest_version == "3.0":
        allowed_files.add(OBJECTS_INVENTORY_NAME)
    entries = list(backup_dir.iterdir())
    unexpected = sorted(
        entry.name
        for entry in entries
        if (
            (entry.is_dir() and entry.name != "objects")
            or (not entry.is_dir() and entry.name not in allowed_files)
        )
    )
    if unexpected:
        fail(f"Unexpected backup-root entries: {unexpected}.")


def verify_inventory(inventory_path: Path, objects_dir: Path, actual_paths: set[str]) -> None:
    inventory: dict[str, tuple[int, str]] = {}
    with inventory_path.open(encoding="utf-8") as source:
        for number, line in enumerate(source, start=1):
            try:
                record = json.loads(line, object_pairs_hook=reject_duplicate_manifest_keys)
            except (json.JSONDecodeError, DuplicateManifestKey):
                fail(f"Malformed object inventory entry at line {number}.")
            if not isinstance(record, dict):
                fail(f"Malformed object inventory entry at line {number}.")
            key = record.get("key")
            size = record.get("size")
            checksum = record.get("sha256")
            if (
                not isinstance(key, str)
                or not key
                or not isinstance(size, int)
                or isinstance(size, bool)
                or size < 0
                or not isinstance(checksum, str)
                or not re.fullmatch(r"[0-9a-f]{64}", checksum)
            ):
                fail(f"Malformed object inventory entry at line {number}.")
            path = PurePosixPath(key)
            if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
                fail(f"Unsafe object inventory key at line {number}.")
            normalized = path.as_posix()
            if normalized in inventory:
                fail(f"Duplicate object inventory entry for {normalized}.")
            inventory[normalized] = (size, checksum)

    if set(inventory) != actual_paths:
        missing = sorted(set(inventory) - actual_paths)
        unlisted = sorted(actual_paths - set(inventory))
        fail(f"Object inventory mismatch: missing={missing}; unlisted={unlisted}.")
    for key, (expected_size, expected_checksum) in inventory.items():
        path = objects_dir / key
        actual_size = path.stat().st_size
        if actual_size != expected_size:
            fail(f"Storage object size mismatch: {key}.")
        if not hmac.compare_digest(sha256_file(path), expected_checksum):
            fail(f"Storage object checksum mismatch: {key}.")


def verify(args: argparse.Namespace) -> None:
    raw_backup_path = Path(args.backup_dir)
    if raw_backup_path.is_symlink():
        fail("Backup directory must not be a symbolic link.")
    backup_dir = raw_backup_path.resolve(strict=True)
    if not backup_dir.is_dir():
        fail("Backup path is not a directory.")
    manifest_path = backup_dir / MANIFEST_NAME
    database_path = backup_dir / "database.sql"
    objects_dir = backup_dir / "objects"

    if manifest_path.is_symlink():
        fail("manifest.json must not be a symbolic link.")
    try:
        manifest = json.loads(
            manifest_path.read_text(encoding="utf-8"),
            object_pairs_hook=reject_duplicate_manifest_keys,
        )
    except FileNotFoundError:
        fail("Missing manifest.json.")
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("manifest.json is not valid UTF-8 JSON.")
    if not isinstance(manifest, dict):
        fail("manifest.json must contain a JSON object.")
    if manifest.get("manifestVersion") not in {"1.0", "2.0", "3.0"}:
        fail("Unsupported or missing manifest version.")
    validate_backup_root(backup_dir, manifest["manifestVersion"])
    if manifest.get("project") != args.expected_project:
        fail("Backup project does not match the explicitly selected deployment.")

    database = manifest.get("database")
    storage = manifest.get("storage")
    if not isinstance(database, dict) or not isinstance(storage, dict):
        fail("Manifest is missing database or storage metadata.")
    if database_path.is_symlink():
        fail("database.sql must not be a symbolic link.")
    if not database_path.is_file():
        fail("Missing regular database.sql file.")
    if database_path.stat().st_size == 0:
        fail("database.sql is empty.")
    expected_database_sha = database.get("sha256")
    if not isinstance(expected_database_sha, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_database_sha):
        fail("Manifest database checksum is missing or malformed.")
    if not hmac.compare_digest(sha256_file(database_path), expected_database_sha):
        fail("Database SHA-256 checksum mismatch.")

    if args.expected_bucket and storage.get("bucket") != args.expected_bucket:
        fail("Backup bucket does not match the selected deployment bucket.")
    if storage.get("directory") not in {"objects", None}:
        fail("Unsupported object directory in manifest.")
    files = object_files(objects_dir)
    actual_paths = {path.relative_to(objects_dir).as_posix() for path in files}
    expected_count = storage.get("objectCount")
    if expected_count is not None and (
        not isinstance(expected_count, int) or isinstance(expected_count, bool) or expected_count != len(files)
    ):
        fail(f"Object count mismatch: manifest={expected_count}, actual={len(files)}.")

    checksum_name = storage.get("objectsChecksumFile", OBJECTS_CHECKSUM_NAME)
    if checksum_name != OBJECTS_CHECKSUM_NAME:
        fail("Unsupported object checksum manifest filename.")
    checksum_path = backup_dir / OBJECTS_CHECKSUM_NAME
    if checksum_path.is_symlink():
        fail("objects.sha256 must not be a symbolic link.")
    if manifest["manifestVersion"] in {"2.0", "3.0"} and not checksum_path.is_file():
        fail("Backup manifest requires a missing objects.sha256 file.")
    if checksum_path.is_file():
        expected_manifest_sha = storage.get("objectsManifestSha256")
        if manifest["manifestVersion"] in {"2.0", "3.0"} and not expected_manifest_sha:
            fail("Manifest is missing the object checksum-list digest.")
        if expected_manifest_sha is not None:
            if not isinstance(expected_manifest_sha, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_manifest_sha):
                fail("Manifest checksum-list digest is malformed.")
            if not hmac.compare_digest(sha256_file(checksum_path), expected_manifest_sha):
                fail("Object checksum-list SHA-256 mismatch.")
        expected_checksums = parse_object_checksums(checksum_path, objects_dir)
        if set(expected_checksums) != actual_paths:
            missing = sorted(set(expected_checksums) - actual_paths)
            unlisted = sorted(actual_paths - set(expected_checksums))
            fail(f"Object manifest mismatch: missing={missing}; unlisted={unlisted}.")
        for relative, expected in expected_checksums.items():
            path = objects_dir / relative
            if not hmac.compare_digest(sha256_file(path), expected):
                fail(f"Storage object checksum mismatch: {relative}.")
        print(f"[OK] SHA-256 checksums verified for database and {len(files)} object(s).")
    else:
        if storage.get("objectsManifestSha256"):
            fail("Manifest references a missing objects.sha256 file.")
        print(
            "[WARN] Legacy backup has no per-object checksum list; object contents were counted "
            "but their accidental corruption cannot be checked."
        )

    if manifest["manifestVersion"] == "3.0":
        inventory_name = storage.get("objectsInventoryFile")
        if inventory_name != OBJECTS_INVENTORY_NAME:
            fail("Manifest is missing or has an unsupported object inventory filename.")
        inventory_path = backup_dir / OBJECTS_INVENTORY_NAME
        if inventory_path.is_symlink():
            fail("objects.jsonl must not be a symbolic link.")
        if not inventory_path.is_file():
            fail("Manifest requires a missing regular objects.jsonl file.")
        expected_inventory_sha = storage.get("objectsInventorySha256")
        if not isinstance(expected_inventory_sha, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_inventory_sha):
            fail("Manifest object inventory digest is missing or malformed.")
        if not hmac.compare_digest(sha256_file(inventory_path), expected_inventory_sha):
            fail("Object inventory SHA-256 mismatch.")
        verify_inventory(inventory_path, objects_dir, actual_paths)
        print(f"[OK] Object sizes and inventory verified for {len(files)} object(s).")

    authentication = manifest.get("authentication")
    auth_required_value = os.environ.get("BACKUP_AUTH_REQUIRED", "").strip().lower()
    if auth_required_value not in {"", "0", "false", "no", "1", "true", "yes"}:
        fail("BACKUP_AUTH_REQUIRED must be a boolean value.")
    require_auth = auth_required_value in {"1", "true", "yes"}
    if authentication is None:
        if require_auth:
            fail("Authenticated verification is required, but this backup is checksum-only.")
        if manifest["manifestVersion"] == "1.0":
            print("[INFO] Legacy manifest version 1.0 is checksum-only; checksums do not authenticate against tampering.")
        elif manifest["manifestVersion"] == "2.0":
            print("[INFO] Manifest version 2.0 uses checksums only; it has no object size inventory and is not tamper-authenticated.")
        else:
            print("[INFO] Checksum-only verification detects accidental corruption, not tampering.")
    else:
        if not isinstance(authentication, dict) or authentication.get("algorithm") != "HMAC-SHA256":
            fail("Unsupported backup authentication metadata.")
        expected_hmac = authentication.get("hmacSha256")
        if not isinstance(expected_hmac, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hmac):
            fail("Manifest HMAC is missing or malformed.")
        key = load_key(backup_dir)
        if key is None:
            fail("This backup is authenticated; set BACKUP_HMAC_KEY_FILE to the separately stored key.")
        actual_hmac = hmac.new(key, manifest_payload(manifest), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(actual_hmac, expected_hmac):
            fail("Manifest HMAC verification failed.")
        print("[OK] HMAC-SHA256 authenticated manifest verified.")

    print(f"[OK] Backup verified: {len(files)} object(s), project={manifest['project']}.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create_parser = commands.add_parser("create")
    create_parser.add_argument("backup_dir")
    create_parser.add_argument("--project", required=True)
    create_parser.add_argument("--database-name", required=True)
    create_parser.add_argument("--database-user", required=True)
    create_parser.add_argument("--bucket", required=True)
    create_parser.add_argument("--timestamp", required=True)
    verify_parser = commands.add_parser("verify")
    verify_parser.add_argument("backup_dir")
    verify_parser.add_argument("--expected-project", default=PROJECT)
    verify_parser.add_argument("--expected-bucket", default="")
    args = parser.parse_args()
    try:
        if args.command == "create":
            create(args)
        else:
            verify(args)
    except (OSError, VerificationError) as error:
        print(f"[FAIL] {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

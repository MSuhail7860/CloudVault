#!/usr/bin/env python3
"""Validate a text export of database storage references against mc JSON output."""

import argparse
import json
import sys
from pathlib import Path


def valid_key(key: str) -> bool:
    if not key or key.startswith("/") or "\\" in key or "\x00" in key:
        return False
    parts = key.split("/")
    return all(part not in {"", ".", ".."} for part in parts)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--references-file", required=True)
    parser.add_argument("--objects-file", required=True)
    parser.add_argument("--excluded-prefixes", default="")
    args = parser.parse_args()

    references_by_key: dict[str, tuple[str, str, int | None]] = {}
    active: set[str] = set()
    retained: set[str] = set()
    excluded_references: set[str] = set()
    references = Path(args.references_file).read_text(encoding="utf-8")
    for line_number, row in enumerate(references.splitlines(), start=1):
        if not row:
            continue
        fields = row.split("|", 3)
        if len(fields) != 4:
            print(f"[FAIL] Malformed database reference row {line_number}.", file=sys.stderr)
            return 1
        kind, owner_id, key, size_value = fields
        if (
            kind not in {"active", "retained", "excluded"}
            or not owner_id
            or "|" in owner_id
            or "/" in owner_id
            or "\\" in owner_id
            or not valid_key(key)
            or not key.startswith(f"{owner_id}/")
            or key.count("/") != 1
        ):
            print(f"[FAIL] Malformed database reference row {line_number}.", file=sys.stderr)
            return 1
        size: int | None = None
        if kind != "excluded":
            try:
                size = int(size_value)
            except ValueError:
                print(f"[FAIL] Malformed database object size at row {line_number}.", file=sys.stderr)
                return 1
            if size < 0:
                print(f"[FAIL] Invalid database object size at row {line_number}.", file=sys.stderr)
                return 1
        elif size_value:
            print(f"[FAIL] Excluded object row {line_number} must not include a size.", file=sys.stderr)
            return 1

        if key in references_by_key:
            print(f"[FAIL] Duplicate or conflicting database object reference: {key}", file=sys.stderr)
            return 1
        references_by_key[key] = (kind, owner_id, size)
        if kind == "active":
            active.add(key)
        elif kind == "retained":
            retained.add(key)
        else:
            excluded_references.add(key)

    objects: set[str] = set()
    object_sizes: dict[str, int] = {}
    object_listing = Path(args.objects_file).read_text(encoding="utf-8")
    if object_listing.strip():
        for line_number, line in enumerate(object_listing.splitlines(), start=1):
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                print(f"[FAIL] Malformed MinIO listing JSON at line {line_number}.", file=sys.stderr)
                return 1
            if not isinstance(record, dict):
                print(f"[FAIL] Malformed MinIO listing entry at line {line_number}.", file=sys.stderr)
                return 1
            object_type = record.get("type")
            if object_type == "folder":
                continue
            status = record.get("status")
            if object_type != "file" or (status is not None and status != "success"):
                print(f"[FAIL] MinIO listing entry {line_number} has an invalid object type.", file=sys.stderr)
                return 1
            key = record.get("key")
            size = record.get("size")
            if (
                not isinstance(key, str)
                or not valid_key(key)
                or not isinstance(size, int)
                or isinstance(size, bool)
                or size < 0
            ):
                print(f"[FAIL] MinIO listing entry {line_number} has an invalid key or size.", file=sys.stderr)
                return 1
            if key in objects:
                print(f"[FAIL] Duplicate object key in MinIO listing: {key}", file=sys.stderr)
                return 1
            objects.add(key)
            object_sizes[key] = size

    missing_active = sorted(active - objects)
    missing_retained = sorted(retained - objects)
    prefixes = [prefix for prefix in args.excluded_prefixes.split(",") if prefix]
    for prefix in prefixes:
        if (
            not prefix.endswith("/")
            or not valid_key(prefix[:-1])
            or prefix.split("/", 1)[0][0].lower() in "0123456789abcdef"
        ):
            print(
                "[FAIL] Excluded prefixes must be explicit non-user namespaces ending with '/'.",
                file=sys.stderr,
            )
            return 1
    excluded_objects = sorted(
        key
        for key in objects
        if key in excluded_references
        or (
            key not in active | retained
            and any(key.startswith(prefix) for prefix in prefixes)
        )
    )
    excluded_missing = sorted(excluded_references - objects)
    unexpected = sorted(objects - active - retained - set(excluded_objects))
    size_mismatches = sorted(
        key
        for key in objects & (active | retained)
        if references_by_key[key][2] != object_sizes[key]
    )

    print(
        f"Consistency counts: active={len(active)}, retained={len(retained)}, "
        f"excluded={len(excluded_objects)}, excluded-missing={len(excluded_missing)}, "
        f"unreferenced={len(unexpected)}, "
        f"missing-active={len(missing_active)}, missing-retained={len(missing_retained)}, "
        f"size-mismatches={len(size_mismatches)}, storage={len(objects)}"
    )
    for key in missing_active:
        print(f"[FAIL] Missing active database object: {key}", file=sys.stderr)
    for key in missing_retained:
        print(f"[FAIL] Missing retained database object: {key}", file=sys.stderr)
    for key in excluded_objects:
        print(f"[INFO] Explicitly excluded object: {key}")
    for key in excluded_missing:
        print(f"[INFO] Explicitly excluded database reference has no object: {key}")
    for key in unexpected:
        print(f"[FAIL] Unexpected unreferenced object: {key}", file=sys.stderr)
    for key in size_mismatches:
        print(f"[FAIL] Database/object size mismatch: {key}", file=sys.stderr)

    if missing_active or missing_retained or unexpected or size_mismatches:
        return 1
    print("[OK] Database-to-storage and storage-to-database consistency verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Reproduce the manifest's native dependency closure from its pinned archive.

Usage: python data/parts-foundation/ldraw/vendor_snapshot.py /path/to/pinned.tar.gz
The archive hash must match manifest.json. No archive member is extracted to an
arbitrary filesystem path; only referenced .dat members and license documents
are copied. The existing root list is the explicit selection input.
"""
from __future__ import annotations

import hashlib
import json
import sys
import tarfile
from pathlib import Path, PurePosixPath


def digest(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def main() -> None:
    target = Path(__file__).resolve().parent
    manifest_path = target / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    archive = Path(sys.argv[1])
    if digest(archive.read_bytes()) != manifest["archive"]["sha256"]:
        raise ValueError("Archive SHA-256 does not match the pinned manifest")
    prefix = "ldraw-" + manifest["revision"] + "/"
    # Reading in archive order avoids repeated seeks through a compressed tar.
    native: dict[str, bytes] = {}
    documents: dict[str, bytes] = {}
    with tarfile.open(archive, "r|gz") as package:
        for member in package:
            if not member.isfile() or not member.name.startswith(prefix):
                continue
            key = member.name[len(prefix):]
            if key in {"CAreadme.txt", "CAlicense.txt", "CAlicense4.txt"}:
                stream = package.extractfile(member)
                if stream is not None:
                    documents[key] = stream.read()
            elif key.startswith(("parts/", "p/")) and key.lower().endswith(".dat"):
                if ".." in PurePosixPath(key).parts:
                    raise ValueError("Unsafe native archive path")
                stream = package.extractfile(member)
                if stream is not None:
                    native[key.lower()] = stream.read()

    copied: dict[str, dict] = {}

    def visit(key: str) -> None:
        if key in copied:
            return
        blob = native[key]
        text = blob.decode("utf-8")
        lines = text.splitlines()
        copied[key] = {
            "path": key,
            "sha256": digest(blob),
            "bytes": len(blob),
            "license": next((line[11:].strip() for line in lines if line.startswith("0 !LICENSE ")), None),
            "author": next((line[9:].strip() for line in lines if line.startswith("0 Author: ")), None),
            "sourceUrl": manifest["sourceRoot"] + key,
        }
        output = target / "files" / key
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(blob)
        for line in lines:
            fields = line.strip().split(None, 14)
            if len(fields) != 15 or fields[0] != "1":
                continue
            reference = fields[14].replace("\\", "/").lower()
            if ".." in PurePosixPath(reference).parts or reference.startswith("/") or ":" in reference:
                raise ValueError("Unsafe native reference")
            choices = [
                str(PurePosixPath(key).parent / reference), reference,
                "parts/" + reference, "p/" + reference,
            ]
            resolved = next((candidate for candidate in choices if candidate in native), None)
            if resolved is None:
                raise ValueError(f"Missing native reference: {key} -> {reference}")
            visit(resolved)

    for root in manifest["roots"]:
        visit(root["path"])
    for name, blob in documents.items():
        (target / name).write_bytes(blob)
    manifest["files"] = [copied[key] for key in sorted(copied)]
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"roots": len(manifest["roots"]), "files": len(copied), "sourceBytes": sum(file["bytes"] for file in copied.values())}))


if __name__ == "__main__":
    main()

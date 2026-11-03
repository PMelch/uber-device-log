#!/usr/bin/env python3
"""Portable ZIP tooling. Full YAML/DSL validation is delegated to a supplied UDL viewer."""
import argparse
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import zipfile
import zlib

FILE_LIMIT = 256 * 1024
ARCHIVE_LIMIT = 4 * 1024 * 1024
EXPANDED_LIMIT = 8 * 1024 * 1024
FILENAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.ya?ml", re.ASCII)


def read_regular(path, limit):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise ValueError("Expected a bounded regular file: " + str(path))
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    with os.fdopen(os.open(str(path), flags), "rb") as stream:
        opened = os.fstat(stream.fileno())
        if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            raise ValueError("File changed while opening: " + str(path))
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError("File exceeds size limit: " + str(path))
    return data


def check_files(files):
    if not 2 <= len(files) <= 101 or "config.yaml" not in files:
        raise ValueError("A bundle requires root config.yaml and 1-100 Blueprint YAML files.")
    if sum(map(len, files.values())) > EXPANDED_LIMIT:
        raise ValueError("Bundle exceeds the 8 MiB expanded limit.")
    for name, data in files.items():
        if not FILENAME.fullmatch(name) or re.search(r"\.draft\.ya?ml$", name, re.IGNORECASE):
            raise ValueError("Unsafe or unsupported bundle filename: " + repr(name))
        if len(data) > FILE_LIMIT:
            raise ValueError("Bundle file exceeds 256 KiB: " + name)
        data.decode("utf-8", errors="strict")
    return files


def read_archive(path):
    data = read_regular(path, ARCHIVE_LIMIT)
    files = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if not 2 <= len(entries) <= 101:
            raise ValueError("A bundle requires config.yaml and 1-100 Blueprint files.")
        if sum(entry.file_size for entry in entries) > EXPANDED_LIMIT:
            raise ValueError("Bundle exceeds the 8 MiB expanded limit.")
        for entry in entries:
            name = entry.filename
            if name != entry.orig_filename or not FILENAME.fullmatch(name) or name in files:
                raise ValueError("Unsafe or duplicate archive path: " + repr(entry.orig_filename))
            kind = stat.S_IFMT(entry.external_attr >> 16)
            if kind not in (0, stat.S_IFREG) or entry.is_dir() or entry.external_attr & 0x10:
                raise ValueError("Bundle entries must be regular files: " + name)
            if entry.flag_bits & 0x41 or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError("Encrypted or unsupported compression: " + name)
            if entry.file_size > FILE_LIMIT:
                raise ValueError("Bundle file exceeds 256 KiB: " + name)
            # Let zipfile verify local headers, names and overlapping entries, but
            # do not use ZipExtFile.read: it truncates output to the declared size.
            with archive.open(entry):
                pass
            header = entry.header_offset
            name_size, extra_size = struct.unpack_from("<HH", data, header + 26)
            start = header + 30 + name_size + extra_size
            compressed = data[start:start + entry.compress_size]
            if len(compressed) != entry.compress_size:
                raise ValueError("Bundle compressed size mismatch: " + name)
            if entry.compress_type == zipfile.ZIP_DEFLATED:
                decompressor = zlib.decompressobj(-15)
                content = decompressor.decompress(compressed, FILE_LIMIT + 1)
                if not decompressor.eof or decompressor.unused_data or decompressor.unconsumed_tail:
                    raise ValueError("Bundle compressed stream or size mismatch: " + name)
            else:
                content = compressed
            if len(content) != entry.file_size:
                raise ValueError("Bundle entry size mismatch: " + name)
            if zlib.crc32(content) != entry.CRC:
                raise ValueError("Bundle entry CRC mismatch: " + name)
            files[name] = content
    return data, check_files(files)


def source_archive(directory):
    if not stat.S_ISDIR(directory.lstat().st_mode):
        raise ValueError("Source must be a regular directory, not a symlink.")
    entries = list(directory.iterdir())
    if len(entries) > 101:
        raise ValueError("A bundle supports at most 101 files including config.yaml.")
    files = check_files({entry.name: read_regular(entry, FILE_LIMIT) for entry in entries})
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(files):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(entry, files[name], compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    data = output.getvalue()
    if len(data) > ARCHIVE_LIMIT:
        raise ValueError("Bundle exceeds the 4 MiB archive limit.")
    return data, files


def viewer_validate(data, viewer_root):
    root = Path(viewer_root).resolve(strict=True)
    source = root / "server/flow-bundles.ts"
    compiled = root / "build/server/flow-bundles.js"
    if source.is_file():
        command = ["node", "--import", "tsx"]
        validator = source
    elif compiled.is_file():
        command = ["node"]
        validator = compiled
    else:
        raise ValueError("Viewer has no compatible bundle validator. Supply an existing viewer checkout/package root.")
    program = """
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { validateFlowBundle } = await import(pathToFileURL(process.argv[1]).href);
const result = await validateFlowBundle(readFileSync(0));
console.log(JSON.stringify({manifest: result.manifest, blueprintIds: result.blueprints.map(item => item.id)}));
"""
    result = subprocess.run(command + ["--input-type=module", "-e", program, str(validator)],
                            input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            cwd=str(root), timeout=30, check=False)
    if result.returncode:
        raise ValueError("Viewer validation failed; no dependencies were installed:\n" + result.stderr.decode("utf-8", errors="replace")[-4000:])
    validated = json.loads(result.stdout)
    if not isinstance(validated.get("manifest", {}).get("id"), str) or not isinstance(validated.get("blueprintIds"), list):
        raise ValueError("Viewer returned an unexpected validation result.")
    return validated


def publish(data, output):
    if output.suffix != ".blueprint":
        raise ValueError("Output filename must end in .blueprint.")
    if output.exists() or output.is_symlink():
        raise ValueError("Output already exists; choose a new destination: " + str(output))
    descriptor, temporary = tempfile.mkstemp(prefix=".blueprint-", suffix=".tmp", dir=str(output.parent))
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, str(output))  # Atomic publication with no replacement.
    finally:
        os.unlink(temporary)


def extract(files, destination):
    destination.mkdir(mode=0o700)  # Never merge into or replace an existing directory.
    try:
        for name, content in files.items():
            with (destination / name).open("xb") as stream:
                stream.write(content)
    except BaseException:
        shutil.rmtree(destination)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    pack = actions.add_parser("pack", help="Package a flat staging directory into a new archive.")
    pack.add_argument("source", type=Path)
    pack.add_argument("output", type=Path)
    validation = pack.add_mutually_exclusive_group(required=True)
    validation.add_argument("--viewer-root", help="Existing compatible viewer checkout/package with dependencies.")
    validation.add_argument("--structural-only", action="store_true", help="Explicitly produce an unvalidated draft archive.")
    for name in ("inspect", "unpack", "validate"):
        action = actions.add_parser(name)
        action.add_argument("bundle", type=Path)
        if name == "unpack":
            action.add_argument("destination", type=Path)
        action.add_argument("--viewer-root", required=name == "validate")
    args = parser.parse_args()
    data, files = source_archive(args.source) if args.action == "pack" else read_archive(args.bundle)
    result = {"structuralValidation": True, "viewerValidation": "not_run", "files": sorted(files)}
    if args.viewer_root:
        result.update(viewer_validate(data, args.viewer_root))
        result["viewerValidation"] = "passed"
    if args.action == "pack":
        if result.get("manifest") and args.output.name != result["manifest"]["id"] + ".blueprint":
            raise ValueError("Output filename must match manifest id: " + result["manifest"]["id"] + ".blueprint")
        publish(data, args.output)
        result["output"] = str(args.output.absolute())
    elif args.action == "unpack":
        extract(files, args.destination)
        result["output"] = str(args.destination.absolute())
    elif args.action == "inspect":
        result["manifestSource"] = files["config.yaml"].decode("utf-8")
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile, zlib.error, struct.error, NotImplementedError, subprocess.SubprocessError) as error:
        print("Bundle operation failed: " + str(error), file=sys.stderr)
        sys.exit(1)

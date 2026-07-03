#!/usr/bin/env python3
"""
fix-perplexity-streaming.py — Patch Chatbox to fix Perplexity streaming errors

Bug: Chatbox bundles @ai-sdk/perplexity 3.0.17 which validates delta.role as a
required literal on every SSE streaming chunk. Perplexity's API only sends role
in the first and last chunks. Mid-stream chunks omit role and fail validation:

    AI_TypeValidationError: Invalid input: expected "assistant"
    at choices[0].delta.role

The fix (released in @ai-sdk/perplexity 3.0.42) makes delta.role optional.
This script applies the same change as a binary patch to the installed
Chatbox app.asar, without needing a full rebuild.

Both the main-process and renderer bundles are patched (each ships its own
copy of the SDK). A timestamped backup is created before any modification.
The app bundle is re-signed with an ad-hoc signature after patching.

Usage:
    python3 scripts/fix-perplexity-streaming.py          # patch + status
    python3 scripts/fix-perplexity-streaming.py --status  # status only
    python3 scripts/fix-perplexity-streaming.py --restore # restore from backup
    python3 scripts/fix-perplexity-streaming.py --app /path/to/Chatbox.app

Requires: Python 3.8+, macOS (uses codesign for re-signing)
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# App detection
# ─────────────────────────────────────────────────────────────────────────────

CANDIDATE_PATHS = [
    Path('/Applications/Chatbox.app'),
    Path.home() / 'Applications/Chatbox.app',
]

def find_chatbox_app(override: str | None = None) -> Path:
    if override:
        p = Path(override)
        if not p.exists():
            die(f'App not found at: {p}')
        return p
    for p in CANDIDATE_PATHS:
        if p.exists():
            return p
    die(
        'Chatbox.app not found.\n'
        'Install Chatbox from https://chatboxai.app or pass --app /path/to/Chatbox.app'
    )


# ─────────────────────────────────────────────────────────────────────────────
# Patches
#
# Two bundles ship their own copy of @ai-sdk/perplexity and both must be fixed:
#   dist/main/main.js       — main (Node) process
#   dist/renderer/js/vendor-ai.*.js — renderer (Chromium) process
#
# The renderer file has a content-hash suffix (e.g. vendor-ai.CW2CM5GZ.js)
# that changes with each build, so we find it by pattern match at runtime.
# ─────────────────────────────────────────────────────────────────────────────

PATCHES = [
    {
        'name': 'main-perplexity-role-optional',
        'asar_path': 'dist/main/main.js',           # exact path
        'asar_glob': None,
        'description': 'perplexityChunkSchema delta.role optional (main process)',
        'applied_marker': b'literal("assistant").optional()',
        'broken_marker':  b'delta:object$3({role:literal("assistant"),content:string$1()})',
        'variants': [
            # A: factory Chatbox 1.21.1 with broken literal
            {
                'find':    b'delta:object$3({role:literal("assistant"),content:string$1()})',
                'replace': b'delta:object$3({role:literal("assistant").optional(),content:string$1().nullish()})',
            },
        ],
    },
    {
        'name': 'renderer-perplexity-role-optional',
        'asar_path': None,                            # resolved at runtime via glob
        'asar_glob': 'dist/renderer/js/vendor-ai.*.js',
        'description': 'perplexityChunkSchema delta.role optional (renderer process)',
        'applied_marker': b'role:g("assistant").optional()',
        'broken_marker':  b'delta:d({role:g("assistant"),content:l()}),finish_reason:l().nullish()})',
        'variants': [
            # Factory Chatbox 1.21.1 renderer (minified: d=object, g=literal, l=string)
            {
                'find':    b'delta:d({role:g("assistant"),content:l()}),finish_reason:l().nullish()})',
                'replace': b'delta:d({role:g("assistant").optional(),content:l().nullish()}),finish_reason:l().nullish()})',
            },
        ],
    },
]

# ─────────────────────────────────────────────────────────────────────────────
# Terminal output
# ─────────────────────────────────────────────────────────────────────────────

_use_color = sys.stdout.isatty()
RED    = '\033[91m' if _use_color else ''
GREEN  = '\033[92m' if _use_color else ''
YELLOW = '\033[93m' if _use_color else ''
CYAN   = '\033[96m' if _use_color else ''
BOLD   = '\033[1m'  if _use_color else ''
RESET  = '\033[0m'  if _use_color else ''

def ok(msg):   print(f'{GREEN}✓{RESET} {msg}')
def fail(msg): print(f'{RED}✗{RESET} {msg}', file=sys.stderr)
def warn(msg): print(f'{YELLOW}⚠{RESET}  {msg}')
def info(msg): print(f'{CYAN}·{RESET} {msg}')
def head(msg): print(f'\n{BOLD}{msg}{RESET}')
def die(msg):
    fail(msg)
    sys.exit(1)

# ─────────────────────────────────────────────────────────────────────────────
# Asar binary manipulation
# ─────────────────────────────────────────────────────────────────────────────

def _parse_asar(path: Path):
    """Return (raw_bytes, header_dict, data_start_offset)."""
    with open(path, 'rb') as f:
        raw = f.read()
    json_len = struct.unpack('<I', raw[12:16])[0]
    header = json.loads(raw[16:16 + json_len])
    pad = (4 - json_len % 4) % 4
    data_start = 16 + json_len + pad
    return raw, header, data_start


def _navigate(header: dict, asar_path: str) -> dict:
    node = header
    for part in asar_path.split('/'):
        node = node['files'][part]
    return node


def _collect_all_files(node: dict, prefix: str = '') -> list:
    results = []
    if 'offset' in node and 'size' in node:
        results.append((prefix, int(node['offset']), node['size']))
    elif 'files' in node:
        for name, child in node['files'].items():
            sub = f'{prefix}/{name}' if prefix else name
            results.extend(_collect_all_files(child, sub))
    return results


def _compute_integrity(data: bytes, block_size: int = 4 * 1024 * 1024) -> dict:
    blocks = [hashlib.sha256(data[i:i+block_size]).hexdigest()
              for i in range(0, len(data), block_size)]
    return {
        'algorithm': 'SHA256',
        'hash': hashlib.sha256(data).hexdigest(),
        'blockSize': block_size,
        'blocks': blocks,
    }


def _set_node_integrity(header: dict, asar_path: str, new_data: bytes, new_offset: int):
    node = _navigate(header, asar_path)
    orig_block_size = node.get('integrity', {}).get('blockSize', 4 * 1024 * 1024)
    node['size'] = len(new_data)
    node['offset'] = str(new_offset)
    node['integrity'] = _compute_integrity(new_data, orig_block_size)


def _read_file_from_asar(asar_path: Path, file_path: str) -> bytes:
    raw, header, data_start = _parse_asar(asar_path)
    node = _navigate(header, file_path)
    offset = int(node['offset'])
    size = node['size']
    return raw[data_start + offset: data_start + offset + size]


def _find_glob_in_asar(asar_path: Path, pattern: str) -> list[str]:
    """Return all asar-relative paths matching fnmatch pattern."""
    _, header, _ = _parse_asar(asar_path)
    all_files = _collect_all_files(header)
    return [p for (p, _, _) in all_files if fnmatch.fnmatch(p, pattern)]


def binary_patch_asar(src: Path, dst: Path, file_patches: dict) -> bool:
    """
    Byte-level patch of named files inside an asar. No external tools needed.

    file_patches: { 'asar/relative/path': (find_bytes, replace_bytes), ... }

    The preamble uses the PADDED json length in fields 1 & 2. Getting this
    wrong by even 1 byte shifts every file read, silently corrupting the bundle.
    """
    raw, header, data_start = _parse_asar(src)
    all_files = _collect_all_files(header)
    all_files.sort(key=lambda x: x[1])

    patched_files = {}
    changed = []

    for (asar_path, offset, size) in all_files:
        file_bytes = raw[data_start + offset: data_start + offset + size]
        if asar_path in file_patches:
            find_b, replace_b = file_patches[asar_path]
            if find_b not in file_bytes:
                warn(f'Pattern not found in {asar_path} — skipping')
                patched_files[asar_path] = file_bytes
                continue
            new_bytes = file_bytes.replace(find_b, replace_b, 1)
            patched_files[asar_path] = new_bytes
            delta = len(new_bytes) - len(file_bytes)
            changed.append((asar_path, delta))
            info(f'Patched {asar_path}  ({delta:+d} bytes)')
        else:
            patched_files[asar_path] = file_bytes

    if not changed:
        warn('No patterns matched — already patched or bundle differs from expected')
        return False

    # Rebuild header with updated sizes, offsets, and integrity hashes
    new_offset = 0
    for (asar_path, orig_offset, orig_size) in all_files:
        new_data = patched_files[asar_path]
        _set_node_integrity(header, asar_path, new_data, new_offset)
        new_offset += len(new_data)

    # Serialise with PADDED json length (Chromium Pickle format requirement)
    new_json     = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode()
    json_len_raw = len(new_json)
    pad          = (4 - json_len_raw % 4) % 4
    padded_len   = json_len_raw + pad
    preamble     = struct.pack('<IIII', 4, padded_len + 8, padded_len + 4, json_len_raw)
    body         = b''.join(patched_files[ap] for (ap, _, _) in all_files)

    with open(dst, 'wb') as f:
        f.write(preamble)
        f.write(new_json + b'\x00' * pad)
        f.write(body)

    ok(f'Wrote patched asar  ({os.path.getsize(dst):,} bytes)')
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Patch status
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_patch_path(patch: dict, asar_path: Path) -> str | None:
    """Resolve the asar-relative file path for a patch, handling glob patterns."""
    if patch['asar_path']:
        return patch['asar_path']
    matches = _find_glob_in_asar(asar_path, patch['asar_glob'])
    if not matches:
        return None
    if len(matches) > 1:
        warn(f'Multiple files match {patch["asar_glob"]}: {matches} — using first')
    return matches[0]


def patch_status(asar_path: Path) -> dict:
    """Return {patch_name: 'applied'|'broken'|'not_found'|'error:...'} for all patches."""
    results = {}
    for p in PATCHES:
        try:
            resolved = _resolve_patch_path(p, asar_path)
            if resolved is None:
                results[p['name']] = 'not_found'
                continue
            content = _read_file_from_asar(asar_path, resolved)
            if p['broken_marker'] in content:
                results[p['name']] = 'broken'
            elif p['applied_marker'] in content:
                results[p['name']] = 'applied'
            else:
                results[p['name']] = 'unknown'
        except (KeyError, FileNotFoundError) as e:
            results[p['name']] = f'error: {e}'
    return results


def all_patches_applied(asar_path: Path) -> bool:
    return all(v == 'applied' for v in patch_status(asar_path).values())


# ─────────────────────────────────────────────────────────────────────────────
# Backup management
# ─────────────────────────────────────────────────────────────────────────────

def _backup_dir(asar: Path) -> Path:
    return asar.parent


def list_backups(asar: Path) -> list:
    return sorted(_backup_dir(asar).glob('app.asar.bak*'), key=lambda p: p.stat().st_mtime)


def make_backup(asar: Path) -> Path:
    ts = datetime.now().strftime('%Y%m%d-%H%M%S')
    dst = _backup_dir(asar) / f'app.asar.bak.{ts}'
    shutil.copy2(asar, dst)
    info(f'Backup: {dst.name}  ({dst.stat().st_size:,} bytes)')
    return dst


def find_best_source(asar: Path) -> Path:
    """Use earliest backup with a broken marker, falling back to current asar."""
    baks = sorted(list_backups(asar), key=lambda p: p.stat().st_mtime)
    for b in baks:
        st = patch_status(b)
        if any(v == 'broken' for v in st.values()):
            return b
    # All backups already patched — patch from the current asar
    return asar


# ─────────────────────────────────────────────────────────────────────────────
# Code signing (macOS)
# ─────────────────────────────────────────────────────────────────────────────

def _has_codesign() -> bool:
    return shutil.which('codesign') is not None


def sign_app(app: Path) -> bool:
    """Ad-hoc re-sign after modifying the asar. Required or macOS silently kills the app."""
    if not _has_codesign():
        warn('codesign not found — skipping re-sign (app may fail to launch)')
        return False
    info('Re-signing with ad-hoc signature…')
    r = subprocess.run(
        ['codesign', '--force', '--deep', '--sign', '-', str(app)],
        capture_output=True, text=True
    )
    if r.returncode == 0:
        ok('App re-signed')
        return True
    fail(f'Code signing failed: {r.stderr.strip()}')
    return False


def verify_signature(app: Path) -> bool:
    if not _has_codesign():
        return True  # can't check, assume ok
    r = subprocess.run(['codesign', '--verify', str(app)], capture_output=True)
    return r.returncode == 0


# ─────────────────────────────────────────────────────────────────────────────
# Commands
# ─────────────────────────────────────────────────────────────────────────────

def cmd_status(app: Path):
    asar = app / 'Contents/Resources/app.asar'
    if not asar.exists():
        die(f'app.asar not found: {asar}')

    version = subprocess.run(
        ['defaults', 'read', str(app / 'Contents/Info'), 'CFBundleShortVersionString'],
        capture_output=True, text=True
    ).stdout.strip() or 'unknown'

    signed = verify_signature(app)
    head(f'Chatbox {version}  {"[signed]" if signed else "[unsigned — re-sign needed]"}')
    info(f'asar: {asar}  ({asar.stat().st_size:,} bytes)')

    statuses = patch_status(asar)
    all_ok = True
    for name, state in statuses.items():
        p = next(x for x in PATCHES if x['name'] == name)
        if state == 'applied':
            ok(f'{name}: applied')
        elif state == 'broken':
            fail(f'{name}: BROKEN — {p["description"]}')
            all_ok = False
        elif state == 'not_found':
            warn(f'{name}: file not found in asar (bundle format changed?)')
            all_ok = False
        else:
            warn(f'{name}: {state}')
            all_ok = False

    baks = list_backups(asar)
    if baks:
        print()
        info(f'Backups ({len(baks)}):')
        for b in baks:
            mtime = datetime.fromtimestamp(b.stat().st_mtime).strftime('%Y-%m-%d %H:%M')
            st = patch_status(b)
            flags = ' '.join('✓' if v == 'applied' else '✗' for v in st.values())
            print(f'    {b.name:50s}  {b.stat().st_size//1024//1024:4d} MB  {mtime}  [{flags}]')

    if not all_ok:
        print()
        print('Run without --status to apply the patch.')

    return all_ok


def cmd_patch(app: Path, dry_run: bool = False, force: bool = False):
    asar = app / 'Contents/Resources/app.asar'
    if not asar.exists():
        die(f'app.asar not found: {asar}')

    head('Applying Perplexity streaming fix')

    if all_patches_applied(asar) and not force:
        ok('All patches already applied')
        if not verify_signature(app):
            sign_app(app)
        return True

    src = find_best_source(asar)
    if src != asar:
        info(f'Patching from backup: {src.name}')

    # Resolve file paths and match variants
    file_patches = {}
    for p in PATCHES:
        resolved = _resolve_patch_path(p, src)
        if resolved is None:
            warn(f'{p["name"]}: {p["asar_glob"]} not found in asar — skipping')
            continue

        content = _read_file_from_asar(src, resolved)
        matched = None
        for v in p['variants']:
            if v['find'] in content:
                matched = v
                break

        if matched is None:
            if p['applied_marker'] in content:
                info(f'{p["name"]}: already applied')
            else:
                warn(f'{p["name"]}: no matching pattern — skipping')
            continue

        file_patches[resolved] = (matched['find'], matched['replace'])

    if not file_patches:
        if all_patches_applied(src):
            ok('Source already fully patched')
            if not dry_run and src != asar:
                make_backup(asar)
                shutil.copy2(src, asar)
                sign_app(app)
            return True
        fail('No applicable patches found — bundle may differ from expected')
        print('  This script targets Chatbox 1.21.1. If you have a different')
        print('  version, the permanent fix is to update @ai-sdk/perplexity')
        print('  to >=3.0.42 in package.json and rebuild.')
        return False

    if dry_run:
        info('Dry run — not writing any files')
        binary_patch_asar(src, Path(os.devnull), file_patches)
        return True

    make_backup(asar)

    with tempfile.NamedTemporaryFile(suffix='.asar', delete=False) as tmp:
        tmp_path = Path(tmp.name)

    try:
        if not binary_patch_asar(src, tmp_path, file_patches):
            fail('Patching failed')
            return False

        new_status = patch_status(tmp_path)
        if not all(s == 'applied' for s in new_status.values()):
            fail('Verification failed after patching:')
            for n, s in new_status.items():
                print(f'  {n}: {s}')
            return False

        shutil.copy2(tmp_path, asar)
        for n, s in new_status.items():
            ok(f'{n}: {s}')

    finally:
        tmp_path.unlink(missing_ok=True)

    sign_app(app)
    print()
    ok('Done — restart Chatbox for the fix to take effect')
    return True


def cmd_restore(app: Path, fragment: str = '', dry_run: bool = False):
    asar = app / 'Contents/Resources/app.asar'
    baks = list_backups(asar)
    if not baks:
        die('No backups found')

    if fragment:
        matches = [b for b in baks if fragment in b.name]
        if not matches:
            die(f'No backup matching "{fragment}"')
        target = matches[0]
    else:
        target = sorted(baks, key=lambda p: p.stat().st_mtime)[0]

    head('Restore from backup')
    info(f'Restoring: {target.name}  ({target.stat().st_size:,} bytes)')

    if dry_run:
        info('Dry run — not writing')
        return

    make_backup(asar)
    shutil.copy2(target, asar)
    ok(f'Restored: {asar}')
    sign_app(app)


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='Patch Chatbox to fix Perplexity streaming errors',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument('--app', metavar='PATH',
                        help='Path to Chatbox.app (default: auto-detect)')
    parser.add_argument('--status', action='store_true',
                        help='Show patch status without making changes')
    parser.add_argument('--restore', nargs='?', const='', metavar='FRAGMENT',
                        help='Restore from backup (default: earliest/original)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Show what would be done without writing files')
    parser.add_argument('--force', action='store_true',
                        help='Re-apply patches even if already applied')
    args = parser.parse_args()

    app = find_chatbox_app(args.app)

    if args.status:
        ok_result = cmd_status(app)
        sys.exit(0 if ok_result else 1)
    elif args.restore is not None:
        cmd_restore(app, fragment=args.restore, dry_run=args.dry_run)
    else:
        ok_result = cmd_patch(app, dry_run=args.dry_run, force=args.force)
        if not ok_result:
            sys.exit(1)


if __name__ == '__main__':
    main()

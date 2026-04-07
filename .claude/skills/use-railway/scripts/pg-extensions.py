#!/usr/bin/env python3
"""
Manage PostgreSQL extensions for Railway database services.

This script replicates the frontend's Extensions.tsx logic:
- List available and installed extensions
- Install extensions with automatic dependency handling
- Uninstall extensions with dependency checking

Usage:
    pg-extensions.py --service <name> list
    pg-extensions.py --service <name> install <extension> [--version <ver>]
    pg-extensions.py --service <name> uninstall <extension>
    pg-extensions.py --service <name> info <extension>

Requires: railway CLI linked to the correct project/environment

IMPORTANT: Install and uninstall require interactive terminal confirmation.
They cannot be run with piped input - the user must confirm directly.
"""

import argparse
import sys
import json
from typing import Tuple, List, Optional, Dict, Any
from dataclasses import dataclass

from dal import run_psql_query, info, error, confirm_with_user


@dataclass
class Extension:
    """PostgreSQL extension info."""
    name: str
    default_version: str
    installed_version: Optional[str]
    comment: str


def list_extensions(service: str, json_output: bool = False) -> List[Extension]:
    """List all available and installed extensions."""
    # Query available extensions
    available_query = "SELECT name, default_version, comment FROM pg_available_extensions ORDER BY name"
    code, output = run_psql_query(service, available_query)
    if code != 0:
        error(f"Failed to query available extensions: {output}")

    # Parse available extensions
    available = {}
    for line in output.strip().split("\n"):
        if not line:
            continue
        parts = line.split("|")
        if len(parts) >= 2:
            name = parts[0].strip()
            version = parts[1].strip()
            comment = parts[2].strip() if len(parts) > 2 else ""
            available[name] = {"version": version, "comment": comment}

    # Query installed extensions
    installed_query = "SELECT extname, extversion FROM pg_extension"
    code, output = run_psql_query(service, installed_query)
    if code != 0:
        error(f"Failed to query installed extensions: {output}")

    # Parse installed extensions
    installed = {}
    for line in output.strip().split("\n"):
        if not line:
            continue
        parts = line.split("|")
        if len(parts) >= 2:
            name = parts[0].strip()
            version = parts[1].strip()
            installed[name] = version

    # Build extension list
    extensions = []
    for name, info in available.items():
        ext = Extension(
            name=name,
            default_version=info["version"],
            installed_version=installed.get(name),
            comment=info["comment"]
        )
        extensions.append(ext)

    if json_output:
        print(json.dumps([{
            "name": e.name,
            "defaultVersion": e.default_version,
            "installedVersion": e.installed_version,
            "comment": e.comment
        } for e in extensions], indent=2))
    else:
        # Print formatted output
        installed_exts = [e for e in extensions if e.installed_version]
        available_exts = [e for e in extensions if not e.installed_version]

        print(f"\n{len(installed_exts)} Extension(s) installed:")
        print("-" * 60)
        if installed_exts:
            for e in sorted(installed_exts, key=lambda x: x.name):
                print(f"  {e.name} (v{e.installed_version})")
        else:
            print("  (none)")

        print(f"\n{len(available_exts)} Extension(s) available:")
        print("-" * 60)
        for e in sorted(available_exts, key=lambda x: x.name)[:30]:
            desc = f" - {e.comment[:50]}..." if e.comment and len(e.comment) > 50 else f" - {e.comment}" if e.comment else ""
            print(f"  {e.name} (v{e.default_version}){desc}")
        if len(available_exts) > 30:
            print(f"  ... and {len(available_exts) - 30} more")

    return extensions


def get_extension_dependencies(service: str, extension: str) -> List[str]:
    """Get dependencies for an extension."""
    query = f"""
        SELECT DISTINCT unnest(pev.requires) as dependency
        FROM pg_available_extension_versions pev
        WHERE pev.name = '{extension}' AND pev.requires IS NOT NULL
        ORDER BY dependency
    """
    code, output = run_psql_query(service, query)
    if code != 0:
        return []

    deps = []
    for line in output.strip().split("\n"):
        if line.strip():
            deps.append(line.strip())
    return deps


def get_extension_dependents(service: str, extension: str) -> List[str]:
    """Get extensions that depend on this extension."""
    query = f"""
        SELECT e.extname AS dependent_extension
        FROM pg_depend d
        JOIN pg_extension e ON d.objid = e.oid
        JOIN pg_extension ref_e ON d.refobjid = ref_e.oid
        WHERE d.classid = 'pg_extension'::regclass
            AND d.refclassid = 'pg_extension'::regclass
            AND ref_e.extname = '{extension}'
        ORDER BY dependent_extension
    """
    code, output = run_psql_query(service, query)
    if code != 0:
        return []

    dependents = []
    for line in output.strip().split("\n"):
        if line.strip():
            dependents.append(line.strip())
    return dependents


def is_extension_installed(service: str, extension: str) -> Tuple[bool, Optional[str]]:
    """Check if extension is installed, return (installed, version)."""
    query = f"SELECT extversion FROM pg_extension WHERE extname = '{extension}'"
    code, output = run_psql_query(service, query)
    if code == 0 and output.strip():
        return True, output.strip()
    return False, None


def is_extension_available(service: str, extension: str) -> bool:
    """Check if extension is available in the image."""
    query = f"SELECT 1 FROM pg_available_extensions WHERE name = '{extension}'"
    code, output = run_psql_query(service, query)
    return code == 0 and output.strip() == "1"


def install_extension(service: str, extension: str, version: Optional[str] = None) -> bool:
    """Install an extension with CASCADE (auto-install dependencies)."""
    # Check if available
    if not is_extension_available(service, extension):
        error(f"Extension '{extension}' is not available in this database image")

    # Check if already installed
    installed, curr_ver = is_extension_installed(service, extension)
    if installed:
        info(f"Extension '{extension}' is already installed (v{curr_ver})")
        return True

    # Check dependencies and confirm - REQUIRES interactive terminal
    deps = get_extension_dependencies(service, extension)
    if deps:
        print(f"\nInstalling '{extension}' will also install these dependencies: {', '.join(deps)}")
    else:
        print(f"\nAbout to install extension '{extension}'")

    if not confirm_with_user("Continue? [y/N]"):
        print("Cancelled.")
        return False

    # Build install query
    query = f'CREATE EXTENSION IF NOT EXISTS "{extension}"'
    if version:
        query += f" VERSION '{version}'"
    query += " CASCADE"  # Auto-install dependencies

    info(f"Installing extension '{extension}'...")
    code, output = run_psql_query(service, query)
    if code != 0:
        error(f"Failed to install extension: {output}")

    # Verify installation
    installed, ver = is_extension_installed(service, extension)
    if installed:
        info(f"Successfully installed '{extension}' (v{ver})")
        if deps:
            info(f"Dependencies installed: {', '.join(deps)}")
        return True
    else:
        error("Extension installation failed - not found after CREATE EXTENSION")
    return False


def uninstall_extension(service: str, extension: str) -> bool:
    """Uninstall an extension."""
    # Check if installed
    installed, ver = is_extension_installed(service, extension)
    if not installed:
        info(f"Extension '{extension}' is not installed")
        return True

    # Check for dependents
    dependents = get_extension_dependents(service, extension)
    if dependents:
        error(f"Cannot uninstall '{extension}' - these extensions depend on it: {', '.join(dependents)}")

    # Confirm - REQUIRES interactive terminal
    print(f"\nAbout to uninstall '{extension}' (v{ver})")
    if not confirm_with_user("Continue? [y/N]"):
        print("Cancelled.")
        return False

    # Uninstall
    query = f'DROP EXTENSION IF EXISTS "{extension}"'
    info(f"Uninstalling extension '{extension}'...")
    code, output = run_psql_query(service, query)
    if code != 0:
        error(f"Failed to uninstall extension: {output}")

    # Verify
    installed, _ = is_extension_installed(service, extension)
    if not installed:
        info(f"Successfully uninstalled '{extension}'")
        return True
    else:
        error("Extension uninstall failed - still found after DROP EXTENSION")
    return False


def extension_info(service: str, extension: str, json_output: bool = False):
    """Show detailed info about an extension."""
    # Check availability
    available = is_extension_available(service, extension)
    if not available:
        error(f"Extension '{extension}' is not available in this database image")

    # Get info
    query = f"SELECT name, default_version, comment FROM pg_available_extensions WHERE name = '{extension}'"
    code, output = run_psql_query(service, query)
    if code != 0:
        error(f"Failed to get extension info: {output}")

    parts = output.strip().split("|")
    name = parts[0].strip() if parts else extension
    default_version = parts[1].strip() if len(parts) > 1 else "unknown"
    comment = parts[2].strip() if len(parts) > 2 else ""

    installed, installed_version = is_extension_installed(service, extension)
    deps = get_extension_dependencies(service, extension)
    dependents = get_extension_dependents(service, extension) if installed else []

    if json_output:
        print(json.dumps({
            "name": name,
            "defaultVersion": default_version,
            "installedVersion": installed_version,
            "comment": comment,
            "dependencies": deps,
            "dependents": dependents
        }, indent=2))
    else:
        print(f"\nExtension: {name}")
        print("-" * 40)
        print(f"  Default Version: {default_version}")
        print(f"  Installed: {'Yes (v' + installed_version + ')' if installed else 'No'}")
        if comment:
            print(f"  Description: {comment}")
        if deps:
            print(f"  Dependencies: {', '.join(deps)}")
        if dependents:
            print(f"  Required by: {', '.join(dependents)}")
        print()


def main():
    parser = argparse.ArgumentParser(
        description="Manage PostgreSQL extensions for Railway services.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  List all extensions (safe, no confirmation needed):
    pg-extensions.py --service my-postgres list

  Install an extension (requires interactive confirmation):
    pg-extensions.py --service my-postgres install postgis
    pg-extensions.py --service my-postgres install pgvector --version 0.5.0

  Uninstall an extension (requires interactive confirmation):
    pg-extensions.py --service my-postgres uninstall postgis

  Get extension info (safe, no confirmation needed):
    pg-extensions.py --service my-postgres info pg_stat_statements

IMPORTANT: Install and uninstall require interactive terminal confirmation.
They cannot be automated or run with piped input.
        """
    )

    parser.add_argument("--service", required=True, help="Service name (requires linked project)")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # list command (safe - no confirmation)
    list_parser = subparsers.add_parser("list", help="List available and installed extensions")

    # install command (requires interactive confirmation)
    install_parser = subparsers.add_parser("install", help="Install an extension (requires confirmation)")
    install_parser.add_argument("extension", help="Extension name")
    install_parser.add_argument("--version", "-v", help="Specific version to install")

    # uninstall command (requires interactive confirmation)
    uninstall_parser = subparsers.add_parser("uninstall", help="Uninstall an extension (requires confirmation)")
    uninstall_parser.add_argument("extension", help="Extension name")

    # info command
    info_parser = subparsers.add_parser("info", help="Show extension info")
    info_parser.add_argument("extension", help="Extension name")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    service = args.service

    if args.command == "list":
        list_extensions(service, json_output=args.json)
    elif args.command == "install":
        install_extension(service, args.extension, version=args.version)
    elif args.command == "uninstall":
        uninstall_extension(service, args.extension)
    elif args.command == "info":
        extension_info(service, args.extension, json_output=args.json)

    return 0


if __name__ == "__main__":
    sys.exit(main())

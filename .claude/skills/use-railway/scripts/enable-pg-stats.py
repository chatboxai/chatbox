#!/usr/bin/env python3
"""
Enable pg_stat_statements for query statistics tracking.

This script replicates the frontend's Metrics.tsx enable logic:
1. Check if pg_stat_statements is already in shared_preload_libraries
2. If yes, just install the extension
3. If no, install extension + ALTER SYSTEM + restart

Usage:
    enable-pg-stats.py --service <name>

Requires: railway CLI linked to the correct project/environment

IMPORTANT: This script requires interactive terminal confirmation.
It cannot be run with piped input - the user must confirm directly.
"""

import argparse
import sys
import re
from typing import List

from dal import run_psql_query, info, error, confirm_with_user


def parse_preload_libraries(value: str) -> List[str]:
    """Parse shared_preload_libraries value into clean library names."""
    if not value or not value.strip():
        return []

    # Split by comma and clean up quotes
    libs = []
    for lib in value.split(","):
        clean = lib.strip().replace('"', '').replace("'", '')
        # Validate as PostgreSQL identifier
        if clean and re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', clean):
            libs.append(clean)
    return libs


def main():
    parser = argparse.ArgumentParser(
        description="Enable pg_stat_statements for query performance tracking.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
What this does:
  1. Checks if pg_stat_statements is already in shared_preload_libraries
  2. Installs the extension: CREATE EXTENSION IF NOT EXISTS pg_stat_statements
  3. If library wasn't preloaded: configures shared_preload_libraries and restarts

Note: If restart is needed, the database will have brief downtime.

IMPORTANT: This script requires interactive terminal confirmation and cannot
be automated. The user must confirm the action directly.
        """
    )

    parser.add_argument("--service", required=True, help="Service name (requires linked project)")

    args = parser.parse_args()
    service = args.service

    # Step 1: Check current shared_preload_libraries
    info("Checking current shared_preload_libraries...")
    code, output = run_psql_query(service, "SHOW shared_preload_libraries")
    if code != 0:
        error(f"Failed to query shared_preload_libraries: {output}")

    current_libs = output
    info(f"Current shared_preload_libraries: {current_libs or '<empty>'}")

    # Check if pg_stat_statements is already loaded
    existing_libs = parse_preload_libraries(current_libs)
    library_already_loaded = "pg_stat_statements" in existing_libs

    if library_already_loaded:
        info("pg_stat_statements is already in shared_preload_libraries")
        needs_restart = False
    else:
        info("pg_stat_statements is NOT in shared_preload_libraries (will need restart)")
        needs_restart = True

    # Step 2: Check if extension is already installed
    info("Checking if pg_stat_statements extension is installed...")
    code, output = run_psql_query(service, "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'")

    extension_exists = code == 0 and output.strip() == "1"

    if extension_exists:
        info("pg_stat_statements extension is already installed")
        needs_install = False
    else:
        info("pg_stat_statements extension needs to be installed")
        needs_install = True

    # If everything is already configured, exit early
    if not needs_restart and not needs_install:
        info("pg_stat_statements is fully configured and ready!")
        print("")
        print("Query statistics are available. Run:")
        print("  SELECT * FROM pg_stat_statements LIMIT 10;")
        return 0

    # Confirm before making changes - REQUIRES interactive terminal
    print("")
    print(f"About to make the following changes to '{service}':")
    if needs_install:
        print("  - Install pg_stat_statements extension")
    if needs_restart:
        print("  - Configure shared_preload_libraries")
        print("  - Restart the database (brief downtime)")
    print("")

    if not confirm_with_user("Continue? [y/N]"):
        print("Cancelled.")
        return 1

    # Step 3: Install extension
    if needs_install:
        info("Installing pg_stat_statements extension...")
        code, output = run_psql_query(service, "CREATE EXTENSION IF NOT EXISTS pg_stat_statements")
        if code != 0:
            error(f"Failed to install extension: {output}")
        info("Extension installed")

    # Step 4: Configure shared_preload_libraries and restart if needed
    if needs_restart:
        info("Configuring shared_preload_libraries...")

        # Add pg_stat_statements to existing libraries
        if "pg_stat_statements" not in existing_libs:
            existing_libs.append("pg_stat_statements")

        # Build ALTER SYSTEM with individual quoted values
        # PostgreSQL syntax: ALTER SYSTEM SET shared_preload_libraries TO 'lib1', 'lib2'
        quoted_libs = ", ".join(f"'{lib}'" for lib in existing_libs)
        alter_query = f"ALTER SYSTEM SET shared_preload_libraries TO {quoted_libs}"

        info(f"Setting shared_preload_libraries to: {', '.join(existing_libs)}")

        code, output = run_psql_query(service, alter_query)
        if code != 0:
            error(f"Failed to configure shared_preload_libraries: {output}")
        info("shared_preload_libraries configured")

        # Step 5: Restart the service
        info("Restarting database service...")
        code, stdout, stderr = run_railway_command(["restart", "--service", service, "--yes"])
        if code != 0:
            error(f"Failed to restart service: {stderr or stdout}")

        print("")
        info("Database is restarting. Query statistics will be available shortly.")
        print("")
        print("After restart completes, verify with:")
        print("  SHOW shared_preload_libraries;")
        print("  SELECT * FROM pg_stat_statements LIMIT 5;")
    else:
        print("")
        info("pg_stat_statements is now ready!")
        print("")
        print("Query statistics are available. Run:")
        print("  SELECT * FROM pg_stat_statements LIMIT 10;")

    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
MySQL analysis for Railway deployments.

Produces a comprehensive report covering:
- Deployment status & resource metrics (CPU, memory, disk)
- Connection overview
- Query throughput & efficiency
- InnoDB buffer pool & row operations
- Lock contention
- Top queries (from performance_schema)
- Table sizes
- Active processes
- Recommendations

Usage:
    analyze-mysql.py --service <name>
    analyze-mysql.py --service <name> --json
    analyze-mysql.py --service <name> --step ssh-test
"""

import argparse
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import dal
from dal import (
    LOG_LINES_DEFAULT, ProgressTimer, RailwayContext,
    _init_context, progress, run_railway_command, run_ssh_query,
    get_railway_status, get_deployment_status,
    get_all_metrics_from_api, _analyze_window, _build_metrics_history,
    get_recent_logs,
    _safe_int, _safe_float, _format_uptime, _trend_indicator,
)


# ---------------------------------------------------------------------------
# Result container
# ---------------------------------------------------------------------------

@dataclass
class MySQLAnalysisResult:
    """Container for MySQL analysis results."""
    service: str
    db_type: str
    timestamp: str
    deployment_status: str = "UNKNOWN"

    # Resource metrics from Railway API
    disk_usage: Optional[Dict[str, Any]] = None
    cpu_memory: Optional[Dict[str, Any]] = None
    metrics_history: Optional[Dict[str, Any]] = None

    # MySQL data
    overview: Optional[Dict[str, Any]] = None
    query_throughput: Optional[Dict[str, Any]] = None
    innodb_row_ops: Optional[Dict[str, Any]] = None
    query_efficiency: Optional[Dict[str, Any]] = None
    innodb_buffer_pool: Optional[Dict[str, Any]] = None
    innodb_io: Optional[Dict[str, Any]] = None
    network: Optional[Dict[str, Any]] = None
    locks: Optional[Dict[str, Any]] = None
    table_cache: Optional[Dict[str, Any]] = None
    top_queries: List[Dict[str, Any]] = field(default_factory=list)
    top_queries_status: Optional[str] = None
    tables: List[Dict[str, Any]] = field(default_factory=list)
    active_processes: List[Dict[str, Any]] = field(default_factory=list)

    # Logs
    recent_logs: List[str] = field(default_factory=list)
    recent_errors: List[str] = field(default_factory=list)

    # Metadata
    collection_status: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    recommendations: List[Dict[str, str]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# MySQL-specific helpers
# ---------------------------------------------------------------------------

def run_mysql_query(service: str, query: str, timeout: int = 30) -> Tuple[int, str]:
    """Run a MySQL query via SSH and return (returncode, output).

    Uses -B (batch) mode which produces tab-separated output with headers.
    Filters out the mysql CLI password warning.
    """
    import base64
    query = " ".join(query.split())
    # Base64-encode the query to avoid all shell quoting issues
    # (single quotes in SQL IN clauses break bash -c '...' wrapping)
    encoded = base64.b64encode(query.encode()).decode()
    command = (
        f'''bash +H -c 'echo {encoded} | base64 -d | MYSQL_PWD="$MYSQLPASSWORD" mysql -h localhost -P 3306 '''
        f'''-u "$MYSQLUSER" -D "$MYSQLDATABASE" --default-character-set=utf8mb4 '''
        f'''-B' '''
    )
    code, stdout, stderr = run_ssh_query(service, command, timeout)
    # Filter out the password warning from stdout (mysql sometimes writes it there)
    lines = []
    for line in stdout.split("\n"):
        if "Using a password on the command line" in line:
            continue
        lines.append(line)
    stdout = "\n".join(lines)
    if code != 0:
        # Also filter warning from stderr
        stderr_clean = "\n".join(
            l for l in stderr.split("\n")
            if "Using a password on the command line" not in l
        )
        return code, stderr_clean or stdout
    return 0, stdout


def parse_mysql_batch(output: str) -> List[Dict[str, str]]:
    """Parse MySQL -B (batch/tab-separated) output into list of dicts.

    First line is column headers, subsequent lines are values.
    """
    lines = [l for l in output.strip().split("\n") if l.strip()]
    if len(lines) < 1:
        return []
    headers = lines[0].split("\t")
    rows = []
    for line in lines[1:]:
        values = line.split("\t")
        if len(values) == len(headers):
            rows.append(dict(zip(headers, values)))
    return rows


def parse_mysql_kv(output: str) -> Dict[str, str]:
    """Parse MySQL SHOW output (Variable_name / Value pairs) into a dict."""
    rows = parse_mysql_batch(output)
    result: Dict[str, str] = {}
    for row in rows:
        name = row.get("Variable_name", "")
        value = row.get("Value", "")
        if name:
            result[name] = value
    return result


# ---------------------------------------------------------------------------
# Railway context / status / metrics helpers
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# MySQL queries
# ---------------------------------------------------------------------------

QUERY_GLOBAL_STATUS = """SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Max_used_connections','Questions','Slow_queries','Com_select','Com_insert','Com_update','Com_delete','Innodb_buffer_pool_read_requests','Innodb_buffer_pool_reads','Innodb_buffer_pool_pages_data','Innodb_buffer_pool_pages_free','Innodb_buffer_pool_pages_dirty','Innodb_row_lock_waits','Innodb_row_lock_time','Uptime','Bytes_received','Bytes_sent','Connections','Aborted_clients','Aborted_connects','Innodb_rows_read','Innodb_rows_inserted','Innodb_rows_updated','Innodb_rows_deleted','Innodb_data_reads','Innodb_data_writes','Innodb_buffer_pool_bytes_data','Innodb_buffer_pool_bytes_dirty','Created_tmp_disk_tables','Created_tmp_tables','Handler_read_rnd_next','Handler_read_first','Handler_read_key','Select_full_join','Select_range','Sort_merge_passes','Table_locks_waited','Table_locks_immediate','Open_tables','Opened_tables')"""

QUERY_VARIABLES = """SHOW VARIABLES WHERE Variable_name IN ('max_connections','innodb_buffer_pool_size','long_query_time','version','table_open_cache','performance_schema')"""

QUERY_TABLE_SIZES = """SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH, DATA_LENGTH + INDEX_LENGTH AS TOTAL_SIZE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TOTAL_SIZE DESC LIMIT 15"""

QUERY_PROCESSLIST = """SHOW PROCESSLIST"""

QUERY_TOP_QUERIES = """SELECT DIGEST, LEFT(DIGEST_TEXT, 200) AS DIGEST_TEXT, COUNT_STAR, ROUND(SUM_TIMER_WAIT/1000000000, 2) AS TOTAL_LATENCY_MS, ROUND(AVG_TIMER_WAIT/1000000000, 2) AS AVG_LATENCY_MS, SUM_ROWS_EXAMINED, SUM_ROWS_SENT, SUM_CREATED_TMP_DISK_TABLES, SUM_NO_INDEX_USED FROM performance_schema.events_statements_summary_by_digest WHERE DIGEST IS NOT NULL AND COUNT_STAR > 0 ORDER BY SUM_TIMER_WAIT DESC LIMIT 15"""


# ---------------------------------------------------------------------------
# MySQL data collection
# ---------------------------------------------------------------------------

def collect_mysql_data(service: str, timeout: int = 30) -> Dict[str, Any]:
    """Collect all MySQL metrics via SSH.

    Batches queries into two SSH calls for efficiency:
      1. SHOW GLOBAL STATUS + SHOW VARIABLES
      2. Table sizes + processlist + top queries (performance_schema)

    Returns a dict with raw parsed data keyed by section.
    """
    data: Dict[str, Any] = {
        "global_status": {},
        "variables": {},
        "tables": [],
        "processlist": [],
        "top_queries": [],
        "errors": [],
    }

    # --- Batch 1: SHOW GLOBAL STATUS; SHOW VARIABLES ---
    batch1_query = QUERY_GLOBAL_STATUS + "; " + QUERY_VARIABLES
    code, output = run_mysql_query(service, batch1_query, timeout=timeout)
    if code != 0:
        data["errors"].append(f"Batch 1 (status/variables) failed: {output}")
    else:
        # MySQL concatenates the two result sets; split them by detecting
        # a second header line starting with Variable_name
        sections = _split_mysql_resultsets(output, "Variable_name")
        if len(sections) >= 1:
            data["global_status"] = parse_mysql_kv(sections[0])
        if len(sections) >= 2:
            data["variables"] = parse_mysql_kv(sections[1])

    # --- Batch 2: tables + processlist + top queries ---
    batch2_query = QUERY_TABLE_SIZES + "; " + QUERY_PROCESSLIST + "; " + QUERY_TOP_QUERIES
    code, output = run_mysql_query(service, batch2_query, timeout=timeout)
    if code != 0:
        # Top queries may fail if performance_schema is off; try without
        batch2_fallback = QUERY_TABLE_SIZES + "; " + QUERY_PROCESSLIST
        code2, output2 = run_mysql_query(service, batch2_fallback, timeout=timeout)
        if code2 != 0:
            data["errors"].append(f"Batch 2 (tables/processlist) failed: {output}")
        else:
            sections = _split_mysql_resultsets_multi(output2, [
                "TABLE_NAME",
                "Id",
            ])
            if len(sections) >= 1:
                data["tables"] = parse_mysql_batch(sections[0])
            if len(sections) >= 2:
                data["processlist"] = parse_mysql_batch(sections[1])
    else:
        sections = _split_mysql_resultsets_multi(output, [
            "TABLE_NAME",
            "Id",
            "DIGEST",
        ])
        if len(sections) >= 1:
            data["tables"] = parse_mysql_batch(sections[0])
        if len(sections) >= 2:
            data["processlist"] = parse_mysql_batch(sections[1])
        if len(sections) >= 3:
            data["top_queries"] = parse_mysql_batch(sections[2])

    return data


def _split_mysql_resultsets(output: str, header_key: str) -> List[str]:
    """Split concatenated MySQL batch output into sections by header line."""
    lines = output.strip().split("\n")
    sections: List[List[str]] = []
    current: List[str] = []

    for line in lines:
        if line.startswith(header_key + "\t") or line.strip() == header_key:
            if current:
                sections.append("\n".join(current))
            current = [line]
        else:
            current.append(line)
    if current:
        sections.append("\n".join(current))

    return sections


def _split_mysql_resultsets_multi(output: str, header_keys: List[str]) -> List[str]:
    """Split concatenated MySQL batch output into sections by multiple different header keys."""
    lines = output.strip().split("\n")
    sections: List[List[str]] = []
    current: List[str] = []
    expected_idx = 0

    for line in lines:
        # Check if this line starts a new result set
        matched = False
        if expected_idx < len(header_keys):
            key = header_keys[expected_idx]
            if line.startswith(key + "\t") or line.strip() == key:
                if current:
                    sections.append("\n".join(current))
                current = [line]
                expected_idx += 1
                matched = True
        # Also check remaining headers in case we skipped one
        if not matched:
            for idx in range(expected_idx, len(header_keys)):
                key = header_keys[idx]
                if line.startswith(key + "\t") or line.strip() == key:
                    if current:
                        sections.append("\n".join(current))
                    current = [line]
                    expected_idx = idx + 1
                    matched = True
                    break
        if not matched:
            current.append(line)

    if current:
        sections.append("\n".join(current))

    return sections


# ---------------------------------------------------------------------------
# Parse collected data into result
# ---------------------------------------------------------------------------

def parse_mysql_data(data: Dict[str, Any], result: MySQLAnalysisResult) -> None:
    """Transform raw MySQL data into structured result sections."""
    gs = data.get("global_status", {})
    vs = data.get("variables", {})

    # --- Overview ---
    version = vs.get("version", "unknown")
    uptime_sec = _safe_int(gs.get("Uptime"))
    threads_connected = _safe_int(gs.get("Threads_connected"))
    threads_running = _safe_int(gs.get("Threads_running"))
    max_used_connections = _safe_int(gs.get("Max_used_connections"))
    max_connections = _safe_int(vs.get("max_connections"), 1)
    aborted_clients = _safe_int(gs.get("Aborted_clients"))
    aborted_connects = _safe_int(gs.get("Aborted_connects"))
    connection_usage_pct = round(max_used_connections / max_connections * 100, 1) if max_connections > 0 else 0

    result.overview = {
        "version": version,
        "uptime_seconds": uptime_sec,
        "uptime_human": _format_uptime(uptime_sec),
        "threads_connected": threads_connected,
        "threads_running": threads_running,
        "max_used_connections": max_used_connections,
        "max_connections": max_connections,
        "connection_usage_percent": connection_usage_pct,
        "aborted_clients": aborted_clients,
        "aborted_connects": aborted_connects,
    }

    # --- Query Throughput ---
    questions = _safe_int(gs.get("Questions"))
    slow_queries = _safe_int(gs.get("Slow_queries"))
    long_query_time = vs.get("long_query_time", "10")
    com_select = _safe_int(gs.get("Com_select"))
    com_insert = _safe_int(gs.get("Com_insert"))
    com_update = _safe_int(gs.get("Com_update"))
    com_delete = _safe_int(gs.get("Com_delete"))

    result.query_throughput = {
        "questions": questions,
        "slow_queries": slow_queries,
        "long_query_time": long_query_time,
        "com_select": com_select,
        "com_insert": com_insert,
        "com_update": com_update,
        "com_delete": com_delete,
    }

    # --- InnoDB Row Operations ---
    result.innodb_row_ops = {
        "rows_read": _safe_int(gs.get("Innodb_rows_read")),
        "rows_inserted": _safe_int(gs.get("Innodb_rows_inserted")),
        "rows_updated": _safe_int(gs.get("Innodb_rows_updated")),
        "rows_deleted": _safe_int(gs.get("Innodb_rows_deleted")),
    }

    # --- Query Efficiency ---
    created_tmp_disk = _safe_int(gs.get("Created_tmp_disk_tables"))
    created_tmp = _safe_int(gs.get("Created_tmp_tables"))
    tmp_disk_pct = round(created_tmp_disk / created_tmp * 100, 1) if created_tmp > 0 else 0
    handler_rnd_next = _safe_int(gs.get("Handler_read_rnd_next"))
    handler_first = _safe_int(gs.get("Handler_read_first"))
    handler_key = _safe_int(gs.get("Handler_read_key"))
    scan_total = handler_rnd_next + handler_first + handler_key
    table_scan_pct = round((handler_rnd_next + handler_first) / scan_total * 100, 1) if scan_total > 0 else 0
    select_full_join = _safe_int(gs.get("Select_full_join"))
    select_range = _safe_int(gs.get("Select_range"))
    sort_merge_passes = _safe_int(gs.get("Sort_merge_passes"))

    result.query_efficiency = {
        "created_tmp_disk_tables": created_tmp_disk,
        "created_tmp_tables": created_tmp,
        "tmp_disk_table_percent": tmp_disk_pct,
        "handler_read_rnd_next": handler_rnd_next,
        "handler_read_first": handler_first,
        "handler_read_key": handler_key,
        "table_scan_percent": table_scan_pct,
        "select_full_join": select_full_join,
        "select_range": select_range,
        "sort_merge_passes": sort_merge_passes,
    }

    # --- InnoDB Buffer Pool ---
    read_requests = _safe_int(gs.get("Innodb_buffer_pool_read_requests"))
    reads = _safe_int(gs.get("Innodb_buffer_pool_reads"))
    hit_ratio = round((read_requests - reads) / read_requests * 100, 2) if read_requests > 0 else 0
    pool_size = _safe_int(vs.get("innodb_buffer_pool_size"))
    bytes_data = _safe_int(gs.get("Innodb_buffer_pool_bytes_data"))
    bytes_dirty = _safe_int(gs.get("Innodb_buffer_pool_bytes_dirty"))
    usage_pct = round(bytes_data / pool_size * 100, 1) if pool_size > 0 else 0
    pages_free = _safe_int(gs.get("Innodb_buffer_pool_pages_free"))
    pages_data = _safe_int(gs.get("Innodb_buffer_pool_pages_data"))
    pages_dirty = _safe_int(gs.get("Innodb_buffer_pool_pages_dirty"))

    result.innodb_buffer_pool = {
        "hit_ratio": hit_ratio,
        "read_requests": read_requests,
        "reads": reads,
        "buffer_pool_size": pool_size,
        "bytes_data": bytes_data,
        "bytes_dirty": bytes_dirty,
        "usage_percent": usage_pct,
        "pages_data": pages_data,
        "pages_free": pages_free,
        "pages_dirty": pages_dirty,
    }

    # --- InnoDB I/O ---
    result.innodb_io = {
        "data_reads": _safe_int(gs.get("Innodb_data_reads")),
        "data_writes": _safe_int(gs.get("Innodb_data_writes")),
    }

    # --- Network ---
    result.network = {
        "bytes_received": _safe_int(gs.get("Bytes_received")),
        "bytes_sent": _safe_int(gs.get("Bytes_sent")),
    }

    # --- Locks ---
    row_lock_waits = _safe_int(gs.get("Innodb_row_lock_waits"))
    row_lock_time = _safe_int(gs.get("Innodb_row_lock_time"))
    table_locks_waited = _safe_int(gs.get("Table_locks_waited"))
    table_locks_immediate = _safe_int(gs.get("Table_locks_immediate"))
    lock_total = table_locks_waited + table_locks_immediate
    table_lock_contention = round(table_locks_waited / lock_total * 100, 2) if lock_total > 0 else 0

    result.locks = {
        "row_lock_waits": row_lock_waits,
        "row_lock_time": row_lock_time,
        "table_locks_waited": table_locks_waited,
        "table_locks_immediate": table_locks_immediate,
        "table_lock_contention": table_lock_contention,
    }

    # --- Table Cache ---
    open_tables = _safe_int(gs.get("Open_tables"))
    opened_tables = _safe_int(gs.get("Opened_tables"))
    table_open_cache = _safe_int(vs.get("table_open_cache"))
    cache_utilization_pct = round(open_tables / table_open_cache * 100, 1) if table_open_cache > 0 else 0
    opens_per_sec = round(opened_tables / uptime_sec, 2) if uptime_sec > 0 else 0

    result.table_cache = {
        "open_tables": open_tables,
        "opened_tables": opened_tables,
        "table_open_cache": table_open_cache,
        "cache_utilization_percent": cache_utilization_pct,
        "opens_per_second": opens_per_sec,
    }

    # --- Top Queries ---
    for row in data.get("top_queries", []):
        result.top_queries.append({
            "digest": row.get("DIGEST", ""),
            "digest_text": row.get("DIGEST_TEXT", ""),
            "count_star": _safe_int(row.get("COUNT_STAR")),
            "total_latency_ms": _safe_float(row.get("TOTAL_LATENCY_MS")),
            "avg_latency_ms": _safe_float(row.get("AVG_LATENCY_MS")),
            "rows_examined": _safe_int(row.get("SUM_ROWS_EXAMINED")),
            "rows_sent": _safe_int(row.get("SUM_ROWS_SENT")),
            "tmp_disk_tables": _safe_int(row.get("SUM_CREATED_TMP_DISK_TABLES")),
            "no_index_used": _safe_int(row.get("SUM_NO_INDEX_USED")),
        })

    if result.top_queries:
        result.top_queries_status = "ok"
    else:
        perf_schema = vs.get("performance_schema", "").upper()
        if perf_schema == "OFF":
            result.top_queries_status = "performance_schema_disabled"
        elif perf_schema == "ON":
            result.top_queries_status = "no_queries_recorded"
        else:
            result.top_queries_status = "unknown"

    # --- Tables ---
    for row in data.get("tables", []):
        result.tables.append({
            "name": row.get("TABLE_NAME", ""),
            "rows": _safe_int(row.get("TABLE_ROWS")),
            "data_length": _safe_int(row.get("DATA_LENGTH")),
            "index_length": _safe_int(row.get("INDEX_LENGTH")),
            "total_size": _safe_int(row.get("TOTAL_SIZE")),
        })

    # --- Active Processes ---
    for row in data.get("processlist", []):
        result.active_processes.append({
            "id": row.get("Id", ""),
            "user": row.get("User", ""),
            "db": row.get("db", ""),
            "command": row.get("Command", ""),
            "time": _safe_int(row.get("Time")),
            "state": row.get("State", ""),
            "info": row.get("Info", ""),
        })


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def _format_count(n: int) -> str:
    """Format large numbers with K/M/G suffix."""
    if n >= 1_000_000_000:
        return f"{n / 1_000_000_000:.1f}G"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return str(n)


def _format_bytes(b: int) -> str:
    """Format bytes to human-readable."""
    if b >= 1_073_741_824:
        return f"{b / 1_073_741_824:.1f} GB"
    if b >= 1_048_576:
        return f"{b / 1_048_576:.1f} MB"
    if b >= 1_024:
        return f"{b / 1_024:.1f} KB"
    return f"{b} B"


def _status_ok_warn_crit(value: float, warn_threshold: float, crit_threshold: float) -> str:
    if value >= crit_threshold:
        return "CRITICAL"
    if value >= warn_threshold:
        return "WARN"
    return "OK"


# ---------------------------------------------------------------------------
# Recommendations
# ---------------------------------------------------------------------------

def generate_recommendations(result: MySQLAnalysisResult) -> List[Dict[str, str]]:
    recs: List[Dict[str, str]] = []

    # Collection failures — surface critical issues when SSH/introspection failed
    if result.collection_status:
        failed = {k: v for k, v in result.collection_status.items()
                  if v.get("status") in ("failed", "error")}
        ssh_sources = {"mysql_query"}
        ssh_failed = {k: v for k, v in failed.items() if k in ssh_sources}
        if ssh_failed:
            sources = ", ".join(ssh_failed.keys())
            errors = "; ".join(v.get("error", "unknown") for v in ssh_failed.values())
            recs.append({
                "severity": "critical",
                "category": "collection",
                "message": f"SSH introspection failed — unable to collect {sources}. "
                           f"Error: {errors}. "
                           f"Analysis is incomplete: InnoDB buffer pool, query throughput, "
                           f"locks, and tuning parameters could not be evaluated.",
            })

    def rec(severity: str, message: str):
        recs.append({"severity": severity, "message": message})

    ov = result.overview or {}
    qt = result.query_throughput or {}
    qe = result.query_efficiency or {}
    bp = result.innodb_buffer_pool or {}
    lk = result.locks or {}
    tc = result.table_cache or {}

    # Connection usage
    conn_pct = ov.get("connection_usage_percent", 0)
    max_conn = ov.get("max_connections", 0)
    if conn_pct >= 90:
        rec("critical", f"Connection usage critical at {conn_pct}%. Approaching max_connections ({max_conn}).")
    elif conn_pct >= 70:
        rec("warning", f"Connection usage at {conn_pct}%. Consider increasing max_connections.")

    # Buffer pool hit ratio
    hit_ratio = bp.get("hit_ratio", 100)
    if hit_ratio < 95:
        rec("critical", f"Buffer pool hit ratio at {hit_ratio}%. Increase innodb_buffer_pool_size.")
    elif hit_ratio < 99:
        rec("warning", f"Buffer pool hit ratio at {hit_ratio}% -- room for improvement with more RAM.")

    # Buffer pool usage
    bp_usage = bp.get("usage_percent", 0)
    if bp_usage > 95:
        rec("warning", f"Buffer pool {bp_usage}% full. Data pages may be evicted under load.")

    # Temp tables to disk
    tmp_pct = qe.get("tmp_disk_table_percent", 0)
    created_disk = qe.get("created_tmp_disk_tables", 0)
    created_total = qe.get("created_tmp_tables", 0)
    if tmp_pct > 25:
        rec("warning", f"{tmp_pct}% of temp tables going to disk. Increase tmp_table_size/max_heap_table_size or optimize queries.")
    elif tmp_pct > 10:
        rec("info", f"Temp tables to disk at {tmp_pct}%. Watch for queries creating large temporary results.")

    # Table scan ratio
    scan_pct = qe.get("table_scan_percent", 0)
    if scan_pct > 75:
        rec("critical", f"Table scan ratio at {scan_pct}%. Most reads are full scans -- add indexes.")
    elif scan_pct > 50:
        rec("warning", f"Table scan ratio at {scan_pct}%. Consider indexing frequently queried columns.")

    # Full joins
    full_joins = qe.get("select_full_join", 0)
    if full_joins > 100:
        rec("warning", f"{_format_count(full_joins)} full joins detected. These scan entire tables -- add indexes to join columns.")

    # Sort merge passes
    sort_passes = qe.get("sort_merge_passes", 0)
    if sort_passes > 0:
        rec("info", f"Sort merge passes ({_format_count(sort_passes)}). Increase sort_buffer_size or optimize queries.")

    # Row lock waits
    row_lock_waits = lk.get("row_lock_waits", 0)
    if row_lock_waits > 1000:
        rec("warning", f"InnoDB row lock waits ({_format_count(row_lock_waits)}). Check for lock contention in concurrent writes.")
    elif row_lock_waits > 0:
        rec("info", f"InnoDB row lock waits ({_format_count(row_lock_waits)}). Check for lock contention in concurrent writes.")

    # Table lock contention
    tl_contention = lk.get("table_lock_contention", 0)
    if tl_contention > 5:
        rec("warning", f"Table lock contention at {tl_contention}%. May indicate MyISAM tables -- convert to InnoDB.")

    # Slow queries
    slow = qt.get("slow_queries", 0)
    threshold = qt.get("long_query_time", "10")
    if slow > 0:
        rec("info", f"{_format_count(slow)} slow queries (threshold: {threshold}s). Review with performance_schema or slow query log.")

    # Aborted clients
    aborted_clients = ov.get("aborted_clients", 0)
    if aborted_clients > 0:
        rec("info", f"{_format_count(aborted_clients)} aborted clients. Applications may not be closing connections properly.")

    # Aborted connects
    aborted_connects = ov.get("aborted_connects", 0)
    if aborted_connects > 0:
        rec("info", f"{_format_count(aborted_connects)} aborted connection attempts. Check authentication issues or connection limits.")

    # No index used in top queries
    if result.top_queries:
        no_index_count = sum(1 for q in result.top_queries if q.get("no_index_used", 0) > 0)
        if no_index_count > 0:
            rec("warning", f"Top queries using no index ({no_index_count} of {len(result.top_queries)}). Missing indexes are likely impacting performance.")

    # Table cache
    tc = result.table_cache or {}
    opens_per_sec = tc.get("opens_per_second", 0)
    cache_util = tc.get("cache_utilization_percent", 0)
    if cache_util >= 95:
        rec("warning", f"Table cache {cache_util}% full ({tc.get('open_tables')}/{tc.get('table_open_cache')}). Increase table_open_cache.")
    if opens_per_sec > 5:
        rec("warning", f"Table opens at {opens_per_sec}/sec — cache may be undersized. Increase table_open_cache.")

    # Top queries diagnostic
    if not result.top_queries:
        if result.top_queries_status == "performance_schema_disabled":
            pass  # Off by default on Railway; overhead (~400MB+) is too high to recommend casually
        elif result.top_queries_status == "no_queries_recorded":
            rec("info", "performance_schema is ON but no queries recorded. Database may be idle or recently restarted.")

    return recs


# ---------------------------------------------------------------------------
# Report formatter
# ---------------------------------------------------------------------------

def format_report(result: MySQLAnalysisResult) -> str:
    lines: List[str] = []

    def heading(title: str, level: int = 2):
        prefix = "#" * level
        lines.append(f"\n{prefix} {title}")

    def table_row(*cells: str):
        lines.append("| " + " | ".join(cells) + " |")

    def table_sep(ncols: int):
        lines.append("| " + " | ".join(["---"] * ncols) + " |")

    # Title
    lines.append(f"# MySQL Analysis: {result.service}")
    lines.append(f"Timestamp: {result.timestamp}")
    lines.append(f"Deployment: {result.deployment_status}")

    # --- Resource Overview (from Railway API) ---
    if result.cpu_memory or result.disk_usage:
        heading("Resource Overview")
        table_row("Metric", "Value")
        table_sep(2)
        if result.cpu_memory:
            cm = result.cpu_memory
            if "cpu_percent" in cm:
                trend = _trend_indicator(result.metrics_history, "cpu")
                lines.append(f"| CPU | {cm['cpu_percent']}% vCPU{trend} |")
            if "memory_gb" in cm:
                trend = _trend_indicator(result.metrics_history, "memory")
                mem_str = f"{cm['memory_gb']} GB"
                if "memory_limit_gb" in cm and cm["memory_limit_gb"] > 0:
                    pct = round(cm["memory_gb"] / cm["memory_limit_gb"] * 100, 1)
                    mem_str += f" / {cm['memory_limit_gb']} GB ({pct}%)"
                lines.append(f"| Memory | {mem_str}{trend} |")
        if result.disk_usage:
            trend = _trend_indicator(result.metrics_history, "disk")
            lines.append(f"| Disk | {result.disk_usage.get('used', 'N/A')}{trend} |")

    # --- Overview ---
    ov = result.overview
    if ov:
        heading("Overview")
        table_row("Metric", "Value", "Status")
        table_sep(3)
        table_row("Version", str(ov["version"]), "")
        table_row("Uptime", ov["uptime_human"], "")
        conn_status = _status_ok_warn_crit(ov["connection_usage_percent"], 70, 90)
        table_row(
            "Connections",
            f"{ov['connection_usage_percent']}% ({ov['max_used_connections']}/{ov['max_connections']})",
            conn_status,
        )
        table_row("Threads Running", str(ov["threads_running"]), "")
        aborted_c_status = "WARN" if ov["aborted_clients"] > 0 else "OK"
        table_row("Aborted Clients", _format_count(ov["aborted_clients"]), aborted_c_status)
        aborted_conn_status = "WARN" if ov["aborted_connects"] > 0 else "OK"
        table_row("Aborted Connects", _format_count(ov["aborted_connects"]), aborted_conn_status)

    # --- Query Throughput ---
    qt = result.query_throughput
    if qt:
        heading("Query Throughput")
        table_row("Metric", "Value", "Status")
        table_sep(3)
        table_row("Total Queries", _format_count(qt["questions"]), "")
        slow_status = "WARN" if qt["slow_queries"] > 0 else "OK"
        table_row("Slow Queries", f"{_format_count(qt['slow_queries'])} (> {qt['long_query_time']}s threshold)", slow_status)
        table_row("SELECT", _format_count(qt["com_select"]), "")
        table_row("INSERT", _format_count(qt["com_insert"]), "")
        table_row("UPDATE", _format_count(qt["com_update"]), "")
        table_row("DELETE", _format_count(qt["com_delete"]), "")

    # --- InnoDB Row Operations ---
    ro = result.innodb_row_ops
    if ro:
        heading("InnoDB Row Operations")
        table_row("Operation", "Count")
        table_sep(2)
        table_row("Rows Read", _format_count(ro["rows_read"]))
        table_row("Rows Inserted", _format_count(ro["rows_inserted"]))
        table_row("Rows Updated", _format_count(ro["rows_updated"]))
        table_row("Rows Deleted", _format_count(ro["rows_deleted"]))

    # --- Query Efficiency ---
    qe = result.query_efficiency
    if qe:
        heading("Query Efficiency")
        table_row("Metric", "Value", "Status")
        table_sep(3)
        tmp_status = _status_ok_warn_crit(qe["tmp_disk_table_percent"], 10, 25)
        table_row(
            "Temp Tables to Disk",
            f"{qe['tmp_disk_table_percent']}% ({_format_count(qe['created_tmp_disk_tables'])}/{_format_count(qe['created_tmp_tables'])})",
            tmp_status,
        )
        scan_status = _status_ok_warn_crit(qe["table_scan_percent"], 50, 75)
        table_row("Table Scan Ratio", f"{qe['table_scan_percent']}%", scan_status)
        fj_status = "WARN" if qe["select_full_join"] > 100 else "OK"
        table_row("Full Joins", _format_count(qe["select_full_join"]), fj_status)
        table_row("Sort Merge Passes", _format_count(qe["sort_merge_passes"]), "")

    # --- InnoDB Buffer Pool ---
    bp = result.innodb_buffer_pool
    if bp:
        heading("InnoDB Buffer Pool")
        table_row("Metric", "Value", "Status")
        table_sep(3)
        hr_status = _status_ok_warn_crit(100 - bp["hit_ratio"], 1, 5)  # inverted: lower hit = worse
        table_row("Cache Hit Ratio", f"{bp['hit_ratio']}%", hr_status)
        usage_status = _status_ok_warn_crit(bp["usage_percent"], 90, 95)
        table_row(
            "Pool Usage",
            f"{bp['usage_percent']}% ({_format_bytes(bp['bytes_data'])}/{_format_bytes(bp['buffer_pool_size'])})",
            usage_status,
        )
        table_row("Dirty Pages", _format_bytes(bp["bytes_dirty"]), "")
        table_row("Free Pages", _format_count(bp["pages_free"]), "")

    # --- Network ---
    nw = result.network
    if nw:
        heading("Network")
        table_row("Metric", "Value")
        table_sep(2)
        table_row("Bytes Received", _format_bytes(nw["bytes_received"]))
        table_row("Bytes Sent", _format_bytes(nw["bytes_sent"]))

    # --- Locks ---
    lk = result.locks
    if lk:
        heading("Locks")
        table_row("Metric", "Value", "Status")
        table_sep(3)
        table_row("Row Lock Waits", _format_count(lk["row_lock_waits"]), "")
        table_row("Row Lock Time (ms)", _format_count(lk["row_lock_time"]), "")
        tl_status = _status_ok_warn_crit(lk["table_lock_contention"], 1, 5)
        table_row("Table Lock Contention", f"{lk['table_lock_contention']}%", tl_status)

    # --- Table Cache ---
    tc = result.table_cache
    if tc:
        heading("Table Cache")
        table_row("Metric", "Value")
        table_sep(2)
        table_row("Open Tables", f"{_format_count(tc['open_tables'])} / {_format_count(tc.get('table_open_cache', 0))}")
        table_row("Cache Utilization", f"{tc.get('cache_utilization_percent', 0)}%")
        table_row("Table Opens/sec", f"{tc.get('opens_per_second', 0)}")

    # --- Top Queries ---
    if result.top_queries:
        heading("Top Queries (by total latency)")
        table_row("Query", "Calls", "Avg Latency", "Total Latency", "Rows Examined", "Rows Sent")
        table_sep(6)
        for q in result.top_queries[:15]:
            digest = q["digest_text"][:60] + "..." if len(q["digest_text"]) > 60 else q["digest_text"]
            # Escape pipe chars in query text
            digest = digest.replace("|", "\\|")
            table_row(
                digest,
                _format_count(q["count_star"]),
                f"{q['avg_latency_ms']:.1f}ms",
                f"{q['total_latency_ms']:.1f}ms",
                _format_count(q["rows_examined"]),
                _format_count(q["rows_sent"]),
            )
    else:
        heading("Top Queries (by total latency)")
        if result.top_queries_status == "performance_schema_disabled":
            lines.append("performance_schema is disabled — no query-level data available.")
            lines.append("Note: enabling it requires ~400MB+ additional memory; only advisable on larger instances.")
        elif result.top_queries_status == "no_queries_recorded":
            lines.append("No queries recorded. Database may be idle or recently restarted.")
        else:
            lines.append("No query data available.")
        lines.append("")

    # --- Tables ---
    if result.tables:
        heading("Tables (by size)")
        table_row("Table", "Rows", "Data", "Indexes", "Total")
        table_sep(5)
        for t in result.tables[:15]:
            table_row(
                t["name"],
                _format_count(t["rows"]),
                _format_bytes(t["data_length"]),
                _format_bytes(t["index_length"]),
                _format_bytes(t["total_size"]),
            )

    # --- Active Queries ---
    if result.active_processes:
        heading("Active Queries")
        # Filter out system processes
        user_procs = [p for p in result.active_processes if p["command"] != "Daemon"]
        if user_procs:
            table_row("User", "Database", "Command", "Time (s)", "Query")
            table_sep(5)
            for p in user_procs[:20]:
                info = (p["info"] or "")[:80]
                info = info.replace("|", "\\|")
                table_row(
                    p["user"],
                    p["db"] or "",
                    p["command"],
                    str(p["time"]),
                    info,
                )
        else:
            lines.append("\nNo active user queries.")

    # --- Infrastructure Metrics ---
    if result.metrics_history:
        windows = result.metrics_history.get("windows", {})
        for window_label, window_data in windows.items():
            mh = window_data.get("metrics", {})
            if not mh:
                continue
            lines.append(f"## Infrastructure Metrics ({window_label})")
            lines.append("| Metric | Current | Min | Max | Avg | Trend |")
            lines.append("|--------|---------|-----|-----|-----|-------|")
            for key in ["cpu", "memory", "disk", "network_rx", "network_tx"]:
                if key in mh:
                    entry = mh[key]
                    trend = entry.get("trend", {})
                    trend_str = trend.get("direction", "N/A")
                    change = trend.get("change_pct", 0)
                    if change != 0:
                        trend_str += f" ({change:+.1f}%)"
                    lines.append(
                        f"| {key.replace('_', ' ').title()} "
                        f"| {entry['current']}{entry['unit']} "
                        f"| {entry['min']}{entry['unit']} "
                        f"| {entry['max']}{entry['unit']} "
                        f"| {entry['avg']}{entry['unit']} "
                        f"| {trend_str} |"
                    )
            lines.append("")

    # --- Collection Errors ---
    if result.errors:
        heading("Collection Errors")
        for err in result.errors:
            lines.append(f"- {err}")

    # --- Recommendations ---
    heading("Recommendations")
    if result.recommendations:
        for r in result.recommendations:
            severity = r["severity"].upper()
            lines.append(f"- **[{severity}]** {r['message']}")
    else:
        lines.append("No issues detected.")

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Main analysis function
# ---------------------------------------------------------------------------

def analyze_mysql(service: str, timeout: int = 60, quiet: bool = False,
                  skip_logs: bool = False, metrics_hours: int = 168,
                  project_id: Optional[str] = None,
                  environment_id: Optional[str] = None,
                  service_id: Optional[str] = None) -> MySQLAnalysisResult:
    """Run complete MySQL analysis."""
    if not quiet:
        print(f"Analyzing mysql database: {service}", file=sys.stderr)

    result = MySQLAnalysisResult(
        service=service,
        db_type="mysql",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )

    # === CONTEXT ===
    if not quiet:
        print("  [0/5] Getting Railway context...", file=sys.stderr, flush=True)
    dal._progress_timer.start()

    if environment_id and service_id:
        dal._ctx = RailwayContext(project_id=project_id, environment_id=environment_id, service_id=service_id)
        if not quiet:
            print(f"        using explicit IDs (env={environment_id[:8]}..., svc={service_id[:8]}...)", file=sys.stderr, flush=True)
    else:
        railway_status = get_railway_status()
        if railway_status:
            dal._ctx = RailwayContext(
                project_id=railway_status.get("projectId"),
                environment_id=railway_status.get("environmentId"),
                service_id=railway_status.get("serviceId"),
            )
        environment_id = dal._ctx.environment_id
        service_id = dal._ctx.service_id

    # === DEPLOYMENT STATUS ===
    progress(1, 5, "Fetching deployment status...", quiet)
    result.deployment_status = get_deployment_status(service, service_id=service_id)

    # === SSH PRE-CHECK ===
    progress(2, 5, "Testing SSH connectivity...", quiet)
    ssh_available = False
    ssh_stderr = ""
    ssh_attempts = [30, 60, 90]
    for attempt, attempt_timeout in enumerate(ssh_attempts, 1):
        ssh_code, ssh_stdout, ssh_stderr = run_ssh_query(service, "echo ok", timeout=attempt_timeout)
        if ssh_code == 0 and "ok" in ssh_stdout:
            ssh_available = True
            if not quiet:
                for line in ssh_stderr.splitlines():
                    if line.startswith("Using SSH key:"):
                        print(f"        {line}", file=sys.stderr, flush=True)
                        break
            break
        if not quiet:
            remaining = len(ssh_attempts) - attempt
            if remaining > 0:
                print(f"        SSH attempt {attempt}/{len(ssh_attempts)} failed ({ssh_stderr or 'no response'}), retrying with {ssh_attempts[attempt]}s timeout...", file=sys.stderr, flush=True)
            else:
                print(f"        SSH attempt {attempt}/{len(ssh_attempts)} failed ({ssh_stderr or 'no response'}), giving up", file=sys.stderr, flush=True)

    # === PARALLEL EXECUTION ===
    progress(3, 5, "Running analysis (metrics, queries, logs in parallel)...", quiet)

    def task_metrics():
        if environment_id and service_id:
            return get_all_metrics_from_api(environment_id, service_id, hours=metrics_hours)
        return None

    def task_mysql_queries():
        if not ssh_available:
            return {"errors": [f"SSH not available: {ssh_stderr or 'connection failed'}"]}
        data = collect_mysql_data(service, timeout=timeout)
        if data.get("errors") and not data.get("global_status"):
            # Retry once
            data = collect_mysql_data(service, timeout=timeout)
        return data

    def task_logs():
        if skip_logs:
            return []
        return get_recent_logs(service, lines=LOG_LINES_DEFAULT,
                               environment_id=environment_id,
                               service_id=service_id)

    with ThreadPoolExecutor(max_workers=3) as executor:
        future_metrics = executor.submit(task_metrics)
        future_mysql = executor.submit(task_mysql_queries)
        future_logs = executor.submit(task_logs)

        metrics_result = future_metrics.result()
        mysql_data = future_mysql.result()
        logs_result = future_logs.result()

    # Process metrics
    if metrics_result:
        result.disk_usage = metrics_result.get("disk_usage")
        result.cpu_memory = metrics_result.get("cpu_memory")
        result.metrics_history = metrics_result.get("metrics_history")
        result.collection_status["metrics_api"] = {"status": "success"}
    else:
        result.collection_status["metrics_api"] = {
            "status": "error",
            "error": "Metrics API returned no data",
        }

    # Process MySQL data
    progress(4, 5, "Processing results...", quiet)
    mysql_errors = mysql_data.get("errors", [])
    if mysql_data.get("global_status"):
        parse_mysql_data(mysql_data, result)
        result.collection_status["mysql_query"] = {"status": "success"}
        if mysql_errors:
            result.collection_status["mysql_query"]["warnings"] = mysql_errors
    else:
        error_msg = "; ".join(mysql_errors) if mysql_errors else "No data returned"
        if not ssh_available:
            error_msg = f"SSH failed after {len(ssh_attempts)} attempts: {ssh_stderr or 'connection failed'}"
        result.errors.append(f"MySQL data collection failed: {error_msg}")
        result.collection_status["mysql_query"] = {
            "status": "error",
            "error": error_msg,
        }

    # Process logs
    if skip_logs:
        result.collection_status["logs_api"] = {"status": "skipped", "reason": "skip_logs flag set"}
    elif logs_result:
        result.recent_logs = logs_result
        result.collection_status["logs_api"] = {"status": "success", "lines": len(logs_result)}
        result.recent_errors = [
            line for line in result.recent_logs
            if "ERROR" in line.upper() or "FATAL" in line.upper()
        ][:100]
    else:
        result.recent_logs = []
        result.collection_status["logs_api"] = {
            "status": "error",
            "error": "Logs API returned no data",
        }

    # === RECOMMENDATIONS ===
    progress(5, 5, "Generating recommendations...", quiet)
    result.recommendations = generate_recommendations(result)

    if not quiet:
        total = dal._progress_timer.total_elapsed()
        print(f"Done.{total}", file=sys.stderr)

    return result


# ---------------------------------------------------------------------------
# Single-step debugging
# ---------------------------------------------------------------------------

def run_single_step(args) -> int:
    """Run a single collection step for debugging."""
    service = args.service
    _init_context(args)
    environment_id = dal._ctx.environment_id
    service_id = dal._ctx.service_id

    if args.step == "ssh-test":
        print(f"Testing SSH to service: {service}", file=sys.stderr)
        code, stdout, stderr = run_ssh_query(service, "echo ok", timeout=45)
        print(f"Exit code: {code}")
        print(f"Stdout: {stdout.strip()}")
        if stderr:
            print(f"Stderr: {stderr.strip()}")
        return 0 if (code == 0 and "ok" in stdout) else 1

    elif args.step == "query":
        print(f"Running MySQL queries on: {service}", file=sys.stderr)
        data = collect_mysql_data(service, timeout=args.timeout)
        print(json.dumps(data, indent=2, default=str))
        return 0 if data.get("global_status") else 1

    elif args.step == "logs":
        print(f"Fetching logs for: {service}", file=sys.stderr)
        logs = get_recent_logs(service, lines=LOG_LINES_DEFAULT,
                               environment_id=environment_id,
                               service_id=service_id)
        print(f"Lines fetched: {len(logs)}")
        for line in logs:
            print(line)
        return 0

    elif args.step == "metrics":
        print(f"Fetching metrics for: {service}", file=sys.stderr)
        if environment_id and service_id:
            metrics = get_all_metrics_from_api(environment_id, service_id)
            if metrics:
                print(json.dumps(metrics, indent=2))
            else:
                print("Metrics API returned no data")
                return 1
        else:
            print("Missing environment_id or service_id from railway config")
            return 1
        return 0

    return 1


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="MySQL analysis for Railway services.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument("--service", required=True, help="Service name")
    parser.add_argument("--json", action="store_true",
                        help="Output as JSON")
    parser.add_argument("--timeout", type=int, default=60,
                        help="Timeout in seconds for SSH queries (default: 60)")
    parser.add_argument("--quiet", "-q", action="store_true",
                        help="Suppress progress messages")
    parser.add_argument("--skip-logs", action="store_true",
                        help="Skip log fetching for faster analysis")
    parser.add_argument("--metrics-hours", type=int, default=168,
                        help="Hours of metrics history to fetch (default: 168, max: 168)")
    parser.add_argument("--step", choices=["ssh-test", "query", "logs", "metrics"],
                        help="Run a single collection step for debugging")
    parser.add_argument("--project-id", help="Project ID (bypasses railway link)")
    parser.add_argument("--environment-id", help="Environment ID (bypasses railway link)")
    parser.add_argument("--service-id", help="Service ID (bypasses railway link)")

    args = parser.parse_args()

    # Single-step debugging mode
    if args.step:
        return run_single_step(args)

    # Run analysis
    result = analyze_mysql(
        args.service,
        timeout=args.timeout,
        quiet=args.quiet,
        skip_logs=args.skip_logs,
        metrics_hours=min(args.metrics_hours, 168),
        project_id=args.project_id,
        environment_id=args.environment_id,
        service_id=args.service_id,
    )

    # Output
    if args.json:
        print(json.dumps(asdict(result), indent=2))
    else:
        print(format_report(result))

    return 0


if __name__ == "__main__":
    sys.exit(main())

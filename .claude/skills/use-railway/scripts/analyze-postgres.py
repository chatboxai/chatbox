#!/usr/bin/env python3
"""
Complete database analysis for Railway deployments.

Produces a comprehensive report covering:
- Deployment status
- Resource overview (disk, connections)
- Memory configuration
- Cache efficiency (overall and per-table)
- Vacuum health
- Query performance (with --deep)
- Index health
- Recommendations

Usage:
    analyze-postgres.py --service <name>
    analyze-postgres.py --service <name> --deep
    analyze-postgres.py --service <name> --json
"""

import argparse
import base64
import json
import os
import subprocess
import sys
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field, asdict

import dal
from dal import (
    LOG_LINES_DEFAULT, ProgressTimer, RailwayContext,
    _init_context, progress, run_railway_command, run_ssh_query, run_psql_query,
    get_railway_status, get_deployment_status,
    get_all_metrics_from_api, _analyze_window, _build_metrics_history,
    get_recent_logs,
    _trend_indicator,
)


@dataclass
class AnalysisResult:
    """Container for analysis results."""
    service: str
    db_type: str
    timestamp: str
    deployment_status: str = "UNKNOWN"
    disk_usage: Optional[Dict[str, Any]] = None
    cpu_memory: Optional[Dict[str, Any]] = None
    connections: Optional[Dict[str, Any]] = None
    connection_states: List[Dict[str, Any]] = field(default_factory=list)
    connections_by_app: List[Dict[str, Any]] = field(default_factory=list)
    connections_by_age: List[Dict[str, Any]] = field(default_factory=list)
    oldest_connection_sec: Optional[int] = None
    oldest_connections: List[Dict[str, Any]] = field(default_factory=list)
    memory_config: Optional[Dict[str, Any]] = None
    cache_hit: Optional[Dict[str, Any]] = None
    cache_per_table: List[Dict[str, Any]] = field(default_factory=list)
    table_sizes: List[Dict[str, Any]] = field(default_factory=list)
    database_stats: Optional[Dict[str, Any]] = None
    size_breakdown: Optional[Dict[str, Any]] = None
    vacuum_health: List[Dict[str, Any]] = field(default_factory=list)
    xid_age: Optional[Dict[str, Any]] = None
    pg_stat_statements_installed: bool = False
    top_queries: List[Dict[str, Any]] = field(default_factory=list)
    long_running_queries: List[Dict[str, Any]] = field(default_factory=list)
    idle_in_transaction: List[Dict[str, Any]] = field(default_factory=list)
    blocked_queries: List[Dict[str, Any]] = field(default_factory=list)
    locks: List[Dict[str, Any]] = field(default_factory=list)
    unused_indexes: List[Dict[str, Any]] = field(default_factory=list)
    invalid_indexes: List[Dict[str, Any]] = field(default_factory=list)
    seq_scan_tables: List[Dict[str, Any]] = field(default_factory=list)
    replication: List[Dict[str, Any]] = field(default_factory=list)
    bgwriter: Optional[Dict[str, Any]] = None
    archiver: Optional[Dict[str, Any]] = None
    progress_vacuum: List[Dict[str, Any]] = field(default_factory=list)
    ssl_stats: Optional[Dict[str, Any]] = None
    ha_cluster: Optional[Dict[str, Any]] = None
    cluster_logs: List[Dict[str, Any]] = field(default_factory=list)
    recent_logs: List[str] = field(default_factory=list)  # Raw unfiltered logs for LLM analysis
    recent_errors: List[str] = field(default_factory=list)  # Legacy: filtered error logs
    metrics_history: Optional[Dict[str, Any]] = None  # Multi-window time series + trend analysis for CPU, memory, disk, network
    collection_status: Dict[str, Dict[str, Any]] = field(default_factory=dict)  # Status of each data source
    errors: List[str] = field(default_factory=list)
    recommendations: List[Dict[str, str]] = field(default_factory=list)



def run_psql_query_safe(service: str, query: str, timeout: int = 60) -> Tuple[int, str, str]:
    """Run a psql query using base64 encoding to avoid shell quoting issues."""
    encoded = base64.b64encode(query.encode()).decode()
    # 2>/dev/null suppresses psql warnings (e.g., collation version mismatch) that pollute stdout
    command = f"echo '{encoded}' | base64 -d | psql $DATABASE_URL -P pager=off -t -A 2>/dev/null"
    return run_ssh_query(service, command, timeout)


def build_analysis_query() -> str:
    """Build a single SQL query that returns all analysis data as JSON."""
    return """
SELECT json_build_object(
    'connections', (
        SELECT json_build_object(
            'current', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()),
            'max', (SELECT setting::int FROM pg_settings WHERE name = 'max_connections'),
            'reserved', (SELECT setting::int FROM pg_settings WHERE name = 'superuser_reserved_connections'),
            'active', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active'),
            'idle', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle'),
            'idle_in_transaction', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction')
        )
    ),
    'memory_config', (
        SELECT json_agg(json_build_object(
            'name', name,
            'setting', setting,
            'unit', unit
        ))
        FROM pg_settings
        WHERE name IN (
            'shared_buffers', 'effective_cache_size', 'work_mem', 'maintenance_work_mem',
            'wal_buffers', 'checkpoint_completion_target', 'min_wal_size', 'max_wal_size',
            'max_parallel_workers', 'max_parallel_workers_per_gather', 'random_page_cost',
            'default_statistics_target', 'synchronous_commit', 'max_connections',
            'autovacuum', 'autovacuum_vacuum_scale_factor', 'autovacuum_analyze_scale_factor',
            'track_activity_query_size', 'log_min_duration_statement',
            'idle_in_transaction_session_timeout', 'statement_timeout',
            'track_io_timing'
        )
    ),
    'cache_hit', (
        SELECT json_build_object(
            'table_hit_pct', ROUND(100.0 * sum(heap_blks_hit) / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2),
            'index_hit_pct', ROUND(100.0 * sum(idx_blks_hit) / NULLIF(sum(idx_blks_hit) + sum(idx_blks_read), 0), 2)
        )
        FROM pg_statio_user_tables
    ),
    'database_stats', (
        SELECT json_build_object(
            'deadlocks', deadlocks,
            'temp_files', temp_files,
            'temp_bytes', temp_bytes,
            'stats_reset', COALESCE(stats_reset::text, 'never'),
            'blks_read', blks_read,
            'blks_hit', blks_hit,
            'tup_returned', tup_returned,
            'tup_fetched', tup_fetched,
            'tup_inserted', tup_inserted,
            'tup_updated', tup_updated,
            'tup_deleted', tup_deleted,
            'conflicts', conflicts,
            'checksum_failures', COALESCE(checksum_failures, 0)
        )
        FROM pg_stat_database
        WHERE datname = current_database()
    ),
    'cache_per_table', (
        SELECT COALESCE(json_agg(t ORDER BY t.disk_reads DESC), '[]'::json)
        FROM (
            SELECT
                relname as table_name,
                heap_blks_read as disk_reads,
                heap_blks_hit as cache_hits,
                ROUND(100.0 * heap_blks_hit / NULLIF(heap_blks_hit + heap_blks_read, 0), 2) as hit_pct
            FROM pg_statio_user_tables
            WHERE heap_blks_read > 10000
            ORDER BY heap_blks_read DESC LIMIT 1000
        ) t
    ),
    'table_sizes', (
        SELECT COALESCE(json_agg(t ORDER BY t.total_bytes DESC), '[]'::json)
        FROM (
            SELECT
                schemaname as schema,
                relname as table_name,
                pg_size_pretty(pg_total_relation_size(relid)) as size,
                pg_total_relation_size(relid) as total_bytes,
                pg_table_size(relid) as data_bytes,
                pg_indexes_size(relid) as index_bytes,
                n_live_tup as row_count
            FROM pg_stat_user_tables
            ORDER BY pg_total_relation_size(relid) DESC LIMIT 1000
        ) t
    ),
    'size_breakdown', (
        SELECT json_build_object(
            'database_bytes', pg_database_size(current_database()),
            'wal_bytes', COALESCE((SELECT sum(size) FROM pg_ls_waldir()), 0),
            'user_tables_bytes', COALESCE((SELECT sum(pg_table_size(relid)) FROM pg_stat_user_tables), 0),
            'user_indexes_bytes', COALESCE((SELECT sum(pg_indexes_size(relid)) FROM pg_stat_user_tables), 0),
            'system_bytes', COALESCE((
                SELECT sum(pg_total_relation_size(c.oid))
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname IN ('pg_catalog', 'information_schema') AND NOT c.relisshared
            ), 0)
        )
    ),
    'vacuum_health', (
        SELECT COALESCE(json_agg(t ORDER BY t.dead_rows DESC), '[]'::json)
        FROM (
            SELECT
                s.schemaname as schema,
                s.relname as table_name,
                n_live_tup as live_rows,
                n_dead_tup as dead_rows,
                CASE WHEN n_live_tup > 0 THEN ROUND(100.0 * n_dead_tup / n_live_tup, 2) ELSE 0 END as dead_pct,
                vacuum_count,
                autovacuum_count,
                COALESCE(last_vacuum::text, 'never') as last_vacuum,
                COALESCE(last_autovacuum::text, 'never') as last_autovacuum,
                COALESCE(last_analyze::text, 'never') as last_analyze,
                age(c.relfrozenxid) as xid_age,
                CASE WHEN n_dead_tup > 1000 AND (n_live_tup = 0 OR n_dead_tup::float / NULLIF(n_live_tup, 0) > 0.1) THEN true ELSE false END as needs_vacuum,
                CASE WHEN age(c.relfrozenxid) > 150000000 THEN true ELSE false END as needs_freeze
            FROM pg_stat_user_tables s
            JOIN pg_class c ON c.oid = s.relid
            WHERE n_dead_tup > 100
            ORDER BY n_dead_tup DESC LIMIT 1000
        ) t
    ),
    'xid_age', (
        SELECT json_build_object(
            'value', age(datfrozenxid)
        )
        FROM pg_database WHERE datname = current_database()
    ),
    'unused_indexes', (
        SELECT COALESCE(json_agg(t ORDER BY t.size_bytes DESC), '[]'::json)
        FROM (
            SELECT
                s.schemaname as schema,
                s.relname as table_name,
                s.indexrelname as index_name,
                pg_size_pretty(pg_relation_size(s.indexrelid)) as size,
                pg_relation_size(s.indexrelid) as size_bytes,
                s.idx_scan as scans,
                t.seq_scan as table_seq_scans,
                t.idx_scan as table_idx_scans,
                t.n_live_tup as table_rows,
                i.indisprimary as is_primary,
                i.indisunique as is_unique,
                CASE WHEN t.seq_scan > 0 AND s.idx_scan = 0 AND t.n_live_tup > 1000
                    THEN t.seq_scan ELSE 0 END as missing_index_score
            FROM pg_stat_user_indexes s
            JOIN pg_stat_user_tables t ON s.relid = t.relid
            JOIN pg_index i ON s.indexrelid = i.indexrelid
            WHERE s.idx_scan = 0 AND pg_relation_size(s.indexrelid) > 8192
            ORDER BY pg_relation_size(s.indexrelid) DESC LIMIT 1000
        ) t
    ),
    'connection_states', (
        SELECT COALESCE(json_agg(t ORDER BY t.count DESC), '[]'::json)
        FROM (
            SELECT state, count(*) as count
            FROM pg_stat_activity
            WHERE datname = current_database()
            GROUP BY state
            ORDER BY count DESC
        ) t
    ),
    'connections_by_app', (
        SELECT COALESCE(json_agg(t ORDER BY t.count DESC), '[]'::json)
        FROM (
            SELECT COALESCE(application_name, '') as app, COUNT(*) as count
            FROM pg_stat_activity
            WHERE datname = current_database()
            GROUP BY application_name
            ORDER BY count DESC LIMIT 100
        ) t
    ),
    'connections_by_age', (
        SELECT COALESCE(json_agg(t), '[]'::json)
        FROM (
            SELECT
                CASE
                    WHEN age_seconds < 60 THEN '< 1 min'
                    WHEN age_seconds < 300 THEN '1-5 min'
                    WHEN age_seconds < 3600 THEN '5-60 min'
                    WHEN age_seconds < 86400 THEN '1-24 hr'
                    ELSE '> 24 hr'
                END as range,
                count(*) as count
            FROM (
                SELECT EXTRACT(EPOCH FROM (now() - backend_start)) as age_seconds
                FROM pg_stat_activity WHERE datname = current_database()
            ) sub
            GROUP BY 1
            ORDER BY MIN(age_seconds)
        ) t
    ),
    'oldest_connection_sec', (
        SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (now() - backend_start)))::int, 0)
        FROM pg_stat_activity
        WHERE datname = current_database()
    ),
    'oldest_connections', (
        SELECT COALESCE(json_agg(t), '[]'::json)
        FROM (
            SELECT
                COALESCE(application_name, '') as application_name,
                state,
                LEFT(query, 100) as query_preview,
                ROUND(EXTRACT(EPOCH FROM (now() - backend_start)) / 3600)::int as age_hours,
                ROUND(EXTRACT(EPOCH FROM (now() - backend_start)) / 86400, 1) as age_days,
                client_addr::text,
                wait_event_type,
                wait_event
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND EXTRACT(EPOCH FROM (now() - backend_start)) > 86400
            ORDER BY backend_start ASC
            LIMIT 5
        ) t
    ),
    'seq_scan_tables', (
        SELECT COALESCE(json_agg(t ORDER BY t.seq_scans DESC), '[]'::json)
        FROM (
            SELECT
                relname as table_name,
                seq_scan as seq_scans,
                idx_scan as idx_scans,
                n_live_tup as rows
            FROM pg_stat_user_tables
            WHERE seq_scan > 100 AND n_live_tup > 1000
            ORDER BY seq_scan DESC LIMIT 100
        ) t
    ),
    'pg_stat_statements_installed', (
        SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements')
    ),
    'top_queries', (
        SELECT COALESCE(json_agg(t), '[]'::json)
        FROM (
            SELECT
                query,
                calls,
                ROUND(total_exec_time::numeric/1000/60, 1) as total_min,
                ROUND(mean_exec_time::numeric, 1) as mean_ms,
                ROUND(min_exec_time::numeric, 1) as min_ms,
                ROUND(max_exec_time::numeric, 1) as max_ms,
                ROUND(stddev_exec_time::numeric, 1) as stddev_ms,
                rows,
                CASE WHEN calls > 0 THEN ROUND(rows::numeric / calls, 2) ELSE 0 END as rows_per_call,
                total_exec_time,
                ROUND(total_plan_time::numeric, 1) as total_plan_ms,
                ROUND(mean_plan_time::numeric, 1) as mean_plan_ms,
                shared_blks_hit,
                shared_blks_read,
                shared_blks_dirtied,
                shared_blks_written,
                ROUND(100.0 * shared_blks_hit / NULLIF(shared_blks_hit + shared_blks_read, 0), 2) as cache_hit_pct,
                local_blks_hit,
                local_blks_read,
                temp_blks_read,
                temp_blks_written,
                ROUND(blk_read_time::numeric, 1) as blk_read_time_ms,
                ROUND(blk_write_time::numeric, 1) as blk_write_time_ms,
                wal_records,
                wal_bytes
            FROM pg_stat_statements s
            JOIN pg_database d ON s.dbid = d.oid
            WHERE d.datname = current_database()
            ORDER BY total_exec_time DESC LIMIT 100
        ) t
    ),
    'long_running_queries', (
        SELECT COALESCE(json_agg(t ORDER BY t.duration_sec DESC), '[]'::json)
        FROM (
            SELECT
                pid,
                EXTRACT(EPOCH FROM (now() - query_start))::int as duration_sec,
                query
            FROM pg_stat_activity
            WHERE state = 'active'
                AND now() - query_start > interval '5 seconds'
            ORDER BY query_start LIMIT 100
        ) t
    ),
    'idle_in_transaction', (
        SELECT COALESCE(json_agg(t ORDER BY t.idle_sec DESC), '[]'::json)
        FROM (
            SELECT
                pid,
                EXTRACT(EPOCH FROM (now() - state_change))::int as idle_sec,
                COALESCE(usename, '') as username,
                COALESCE(application_name, '') as app,
                query as last_query
            FROM pg_stat_activity
            WHERE state = 'idle in transaction'
                AND now() - state_change > interval '30 seconds'
            ORDER BY state_change LIMIT 100
        ) t
    ),
    'blocked_queries', (
        SELECT COALESCE(json_agg(t ORDER BY t.wait_sec DESC), '[]'::json)
        FROM (
            SELECT
                blocked.pid,
                EXTRACT(EPOCH FROM (now() - blocked.query_start))::int as wait_sec,
                COALESCE(blocked.usename, '') as username,
                COALESCE(blocking.pid::text, '') as blocking_pid,
                left(blocked.query, 60) as query
            FROM pg_stat_activity blocked
            JOIN pg_locks blocked_locks ON blocked.pid = blocked_locks.pid
            JOIN pg_locks blocking_locks ON blocked_locks.locktype = blocking_locks.locktype
                AND blocked_locks.database IS NOT DISTINCT FROM blocking_locks.database
                AND blocked_locks.relation IS NOT DISTINCT FROM blocking_locks.relation
                AND blocked_locks.page IS NOT DISTINCT FROM blocking_locks.page
                AND blocked_locks.tuple IS NOT DISTINCT FROM blocking_locks.tuple
                AND blocked_locks.virtualxid IS NOT DISTINCT FROM blocking_locks.virtualxid
                AND blocked_locks.transactionid IS NOT DISTINCT FROM blocking_locks.transactionid
                AND blocked_locks.classid IS NOT DISTINCT FROM blocking_locks.classid
                AND blocked_locks.objid IS NOT DISTINCT FROM blocking_locks.objid
                AND blocked_locks.objsubid IS NOT DISTINCT FROM blocking_locks.objsubid
                AND blocked_locks.pid != blocking_locks.pid
            JOIN pg_stat_activity blocking ON blocking_locks.pid = blocking.pid
            WHERE NOT blocked_locks.granted
            ORDER BY blocked.query_start LIMIT 100
        ) t
    ),
    'locks', (
        SELECT COALESCE(json_agg(t), '[]'::json)
        FROM (
            SELECT
                l.locktype,
                l.mode,
                COALESCE(a.usename, '') as username,
                COALESCE(a.application_name, '') as app,
                left(COALESCE(a.query, ''), 50) as query
            FROM pg_locks l
            JOIN pg_stat_activity a ON l.pid = a.pid
            WHERE a.datname = current_database() AND NOT l.granted
            LIMIT 100
        ) t
    ),
    'replication', (
        SELECT COALESCE(json_agg(t), '[]'::json)
        FROM (
            SELECT
                COALESCE(client_addr::text, 'local') as client,
                state,
                sent_lsn::text as sent_lsn,
                replay_lsn::text as replay_lsn
            FROM pg_stat_replication
        ) t
    ),
    'bgwriter', (
        SELECT json_build_object(
            'checkpoints_timed', checkpoints_timed,
            'checkpoints_req', checkpoints_req,
            'buffers_checkpoint', buffers_checkpoint,
            'buffers_clean', buffers_clean,
            'buffers_backend', buffers_backend,
            'buffers_backend_fsync', buffers_backend_fsync,
            'maxwritten_clean', maxwritten_clean,
            'stats_reset', COALESCE(stats_reset::text, 'never')
        )
        FROM pg_stat_bgwriter
    ),
    'invalid_indexes', (
        SELECT COALESCE(json_agg(json_build_object(
            'schema', n.nspname,
            'table', c.relname,
            'index', i.relname
        )), '[]'::json)
        FROM pg_index x
        JOIN pg_class c ON c.oid = x.indrelid
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT x.indisvalid
    ),
    'archiver', (
        SELECT json_build_object(
            'archived_count', archived_count,
            'failed_count', failed_count,
            'last_archived_wal', last_archived_wal,
            'last_archived_time', COALESCE(last_archived_time::text, 'never'),
            'last_failed_wal', last_failed_wal,
            'last_failed_time', COALESCE(last_failed_time::text, 'never'),
            'stats_reset', COALESCE(stats_reset::text, 'never')
        )
        FROM pg_stat_archiver
    ),
    'progress_vacuum', (
        SELECT COALESCE(json_agg(json_build_object(
            'pid', p.pid,
            'datname', d.datname,
            'relname', c.relname,
            'phase', p.phase,
            'heap_blks_total', p.heap_blks_total,
            'heap_blks_scanned', p.heap_blks_scanned,
            'heap_blks_vacuumed', p.heap_blks_vacuumed,
            'index_vacuum_count', p.index_vacuum_count,
            'max_dead_tuples', p.max_dead_tuples,
            'num_dead_tuples', p.num_dead_tuples
        )), '[]'::json)
        FROM pg_stat_progress_vacuum p
        JOIN pg_database d ON p.datid = d.oid
        LEFT JOIN pg_class c ON p.relid = c.oid
    ),
    'ssl_stats', (
        SELECT json_build_object(
            'ssl_connections', (SELECT count(*) FROM pg_stat_ssl WHERE ssl = true),
            'non_ssl_connections', (SELECT count(*) FROM pg_stat_ssl WHERE ssl = false),
            'ssl_versions', (
                SELECT COALESCE(json_agg(json_build_object('version', version, 'count', cnt)), '[]'::json)
                FROM (SELECT version, count(*) as cnt FROM pg_stat_ssl WHERE ssl = true GROUP BY version) v
            )
        )
    )
)::text;
"""


def parse_batched_analysis(data: Dict[str, Any], result: AnalysisResult) -> None:
    """Parse the batched JSON analysis data into the result object."""

    # Connections
    conn = data.get("connections")
    if conn:
        current = conn.get("current", 0)
        max_conn = conn.get("max", 1)
        reserved = conn.get("reserved", 3)
        result.connections = {
            "current": current,
            "max": max_conn,
            "reserved": reserved,
            "available": max_conn - current - reserved,
            "percent": round(current / max_conn * 100, 1) if max_conn > 0 else 0,
            "active": conn.get("active", 0),
            "idle": conn.get("idle", 0),
            "idle_in_transaction": conn.get("idle_in_transaction", 0),
        }

    # Memory config (expanded for tuning analysis)
    mem_config = data.get("memory_config")
    if mem_config:
        result.memory_config = {}
        for row in mem_config:
            name = row["name"]
            setting = row["setting"]
            unit = row["unit"]

            # Handle different value types
            if unit == "8kB":
                # Convert 8kB pages to MB
                mb = int(setting) * 8 / 1024 if str(setting).isdigit() else 0
                result.memory_config[name] = {"value": int(setting) if str(setting).isdigit() else 0, "unit": unit, "mb": round(mb, 1)}
            elif unit == "kB":
                mb = int(setting) / 1024 if str(setting).isdigit() else 0
                result.memory_config[name] = {"value": int(setting) if str(setting).isdigit() else 0, "unit": unit, "mb": round(mb, 1)}
            elif unit == "MB":
                result.memory_config[name] = {"value": int(setting) if str(setting).isdigit() else 0, "unit": unit, "mb": int(setting) if str(setting).isdigit() else 0}
            elif unit in ("ms", "s", "min"):
                # Time-based settings
                result.memory_config[name] = {"value": setting, "unit": unit}
            elif name in ("random_page_cost", "checkpoint_completion_target", "autovacuum_vacuum_scale_factor", "autovacuum_analyze_scale_factor"):
                # Float settings
                result.memory_config[name] = {"value": float(setting) if setting else 0}
            elif name in ("synchronous_commit", "autovacuum", "track_io_timing"):
                # On/off settings
                result.memory_config[name] = {"value": setting}
            else:
                # Integer settings (max_connections, max_parallel_workers, etc.)
                result.memory_config[name] = {"value": int(setting) if str(setting).isdigit() else setting}

    # Cache hit
    cache = data.get("cache_hit")
    if cache:
        result.cache_hit = {
            "table_hit_pct": cache.get("table_hit_pct"),
            "index_hit_pct": cache.get("index_hit_pct"),
        }

    # Database stats
    db_stats = data.get("database_stats")
    if db_stats:
        result.database_stats = {
            "deadlocks": db_stats.get("deadlocks", 0),
            "temp_files": db_stats.get("temp_files", 0),
            "temp_bytes": db_stats.get("temp_bytes", 0),
            "stats_reset": db_stats.get("stats_reset", "unknown"),
            "blks_read": db_stats.get("blks_read", 0),
            "blks_hit": db_stats.get("blks_hit", 0),
            "tup_returned": db_stats.get("tup_returned", 0),
            "tup_fetched": db_stats.get("tup_fetched", 0),
            "tup_inserted": db_stats.get("tup_inserted", 0),
            "tup_updated": db_stats.get("tup_updated", 0),
            "tup_deleted": db_stats.get("tup_deleted", 0),
            "conflicts": db_stats.get("conflicts", 0),
            "checksum_failures": db_stats.get("checksum_failures", 0),
        }

    # Cache per table
    cache_per_table = data.get("cache_per_table", [])
    result.cache_per_table = [
        {
            "table": t.get("table_name"),
            "disk_reads": str(t.get("disk_reads", 0)),
            "cache_hits": str(t.get("cache_hits", 0)),
            "hit_pct": str(t.get("hit_pct", 0)),
        }
        for t in cache_per_table
    ]

    # Table sizes
    table_sizes = data.get("table_sizes", [])
    result.table_sizes = [
        {
            "schema": t.get("schema"),
            "table": t.get("table_name"),
            "size": t.get("size"),
            "total_bytes": str(t.get("total_bytes", 0)),
            "data_bytes": str(t.get("data_bytes", 0)),
            "index_bytes": str(t.get("index_bytes", 0)),
            "row_count": str(t.get("row_count", 0)),
        }
        for t in table_sizes
    ]

    # Size breakdown
    size = data.get("size_breakdown")
    if size:
        result.size_breakdown = {
            "database_bytes": size.get("database_bytes", 0),
            "wal_bytes": size.get("wal_bytes", 0),
            "user_tables_bytes": size.get("user_tables_bytes", 0),
            "user_indexes_bytes": size.get("user_indexes_bytes", 0),
            "system_bytes": size.get("system_bytes", 0),
        }

    # Vacuum health
    vacuum = data.get("vacuum_health", [])
    result.vacuum_health = [
        {
            "schema": t.get("schema"),
            "table": t.get("table_name"),
            "live_rows": str(t.get("live_rows", 0)),
            "dead_rows": str(t.get("dead_rows", 0)),
            "dead_pct": str(t.get("dead_pct", 0)),
            "vacuum_count": str(t.get("vacuum_count", 0)),
            "autovacuum_count": str(t.get("autovacuum_count", 0)),
            "last_vacuum": t.get("last_vacuum", "never"),
            "last_autovacuum": t.get("last_autovacuum", "never"),
            "last_analyze": t.get("last_analyze", "never"),
            "xid_age": str(t.get("xid_age", 0)),
            "needs_vacuum": "true" if t.get("needs_vacuum") else "false",
            "needs_freeze": "true" if t.get("needs_freeze") else "false",
        }
        for t in vacuum
    ]

    # XID age
    xid = data.get("xid_age")
    if xid and xid.get("value") is not None:
        xid_val = xid["value"]
        result.xid_age = {
            "value": xid_val,
            "millions": round(xid_val / 1_000_000, 1),
            "pct_to_wraparound": round(xid_val / 2_147_483_647 * 100, 2)
        }

    # Unused indexes
    unused = data.get("unused_indexes", [])
    result.unused_indexes = [
        {
            "schema": t.get("schema"),
            "table": t.get("table_name"),
            "index": t.get("index_name"),
            "size": t.get("size"),
            "size_bytes": str(t.get("size_bytes", 0)),
            "scans": str(t.get("scans", 0)),
            "table_seq_scans": str(t.get("table_seq_scans", 0)),
            "table_idx_scans": str(t.get("table_idx_scans", 0)),
            "table_rows": str(t.get("table_rows", 0)),
            "is_primary": t.get("is_primary", False),
            "is_unique": t.get("is_unique", False),
            "missing_index_score": str(t.get("missing_index_score", 0)),
        }
        for t in unused
    ]

    # Connection states
    conn_states = data.get("connection_states", [])
    result.connection_states = [
        {"state": t.get("state"), "count": str(t.get("count", 0))}
        for t in conn_states
    ]

    # Connections by app
    conn_app = data.get("connections_by_app", [])
    result.connections_by_app = [
        {"app": t.get("app", ""), "count": str(t.get("count", 0))}
        for t in conn_app
    ]

    # Connections by age
    conn_age = data.get("connections_by_age", [])
    result.connections_by_age = [
        {"range": t.get("range"), "count": str(t.get("count", 0))}
        for t in conn_age
    ]

    # Oldest connection
    oldest = data.get("oldest_connection_sec")
    if oldest is not None:
        result.oldest_connection_sec = oldest

    # Details of old connections (>24 hours)
    oldest_conns = data.get("oldest_connections", [])
    result.oldest_connections = [
        {
            "application_name": c.get("application_name", ""),
            "state": c.get("state"),
            "query_preview": c.get("query_preview"),
            "age_hours": c.get("age_hours"),
            "age_days": c.get("age_days"),
            "client_addr": c.get("client_addr"),
            "wait_event_type": c.get("wait_event_type"),
            "wait_event": c.get("wait_event"),
        }
        for c in oldest_conns
    ]

    # Seq scan tables
    seq_tables = data.get("seq_scan_tables", [])
    result.seq_scan_tables = [
        {
            "table": t.get("table_name"),
            "seq_scans": str(t.get("seq_scans", 0)),
            "idx_scans": str(t.get("idx_scans", 0)),
            "rows": str(t.get("rows", 0)),
        }
        for t in seq_tables
    ]

    # Top queries
    top_q = data.get("top_queries", [])
    result.top_queries = [
        {
            "query": t.get("query"),
            "calls": str(t.get("calls", 0)),
            "total_min": str(t.get("total_min", 0)),
            "mean_ms": str(t.get("mean_ms", 0)),
            "min_ms": str(t.get("min_ms", 0)),
            "max_ms": str(t.get("max_ms", 0)),
            "stddev_ms": str(t.get("stddev_ms", 0)),
            "rows": str(t.get("rows", 0)),
            "rows_per_call": str(t.get("rows_per_call", 0)),
            "total_plan_ms": str(t.get("total_plan_ms", 0)),
            "mean_plan_ms": str(t.get("mean_plan_ms", 0)),
            "shared_blks_hit": t.get("shared_blks_hit", 0),
            "shared_blks_read": t.get("shared_blks_read", 0),
            "shared_blks_dirtied": t.get("shared_blks_dirtied", 0),
            "shared_blks_written": t.get("shared_blks_written", 0),
            "cache_hit_pct": t.get("cache_hit_pct"),
            "local_blks_hit": t.get("local_blks_hit", 0),
            "local_blks_read": t.get("local_blks_read", 0),
            "temp_blks_read": t.get("temp_blks_read", 0),
            "temp_blks_written": t.get("temp_blks_written", 0),
            "blk_read_time_ms": str(t.get("blk_read_time_ms", 0)),
            "blk_write_time_ms": str(t.get("blk_write_time_ms", 0)),
            "wal_records": t.get("wal_records", 0),
            "wal_bytes": t.get("wal_bytes", 0),
        }
        for t in top_q
    ]

    # Long running queries
    long_q = data.get("long_running_queries", [])
    result.long_running_queries = [
        {
            "pid": str(t.get("pid")),
            "duration_sec": str(t.get("duration_sec", 0)),
            "query": t.get("query"),
        }
        for t in long_q
    ]

    # Idle in transaction
    idle_txn = data.get("idle_in_transaction", [])
    result.idle_in_transaction = [
        {
            "pid": str(t.get("pid")),
            "idle_sec": str(t.get("idle_sec", 0)),
            "user": t.get("username", ""),
            "app": t.get("app", ""),
            "last_query": t.get("last_query"),
        }
        for t in idle_txn
    ]

    # Blocked queries
    blocked = data.get("blocked_queries", [])
    result.blocked_queries = [
        {
            "pid": str(t.get("pid")),
            "wait_sec": str(t.get("wait_sec", 0)),
            "user": t.get("username", ""),
            "blocking_pid": t.get("blocking_pid", ""),
            "query": t.get("query"),
        }
        for t in blocked
    ]

    # Locks
    locks = data.get("locks", [])
    result.locks = [
        {
            "locktype": t.get("locktype"),
            "mode": t.get("mode"),
            "user": t.get("username", ""),
            "app": t.get("app", ""),
            "query": t.get("query"),
        }
        for t in locks
    ]

    # Replication
    repl = data.get("replication", [])
    result.replication = [
        {
            "client": t.get("client"),
            "state": t.get("state"),
            "sent_lsn": t.get("sent_lsn"),
            "replay_lsn": t.get("replay_lsn"),
        }
        for t in repl
    ]

    # pg_stat_statements installed flag
    result.pg_stat_statements_installed = data.get("pg_stat_statements_installed", False)

    # Background writer stats
    bgwriter = data.get("bgwriter")
    if bgwriter:
        result.bgwriter = {
            "checkpoints_timed": bgwriter.get("checkpoints_timed", 0),
            "checkpoints_req": bgwriter.get("checkpoints_req", 0),
            "buffers_checkpoint": bgwriter.get("buffers_checkpoint", 0),
            "buffers_clean": bgwriter.get("buffers_clean", 0),
            "buffers_backend": bgwriter.get("buffers_backend", 0),
            "buffers_backend_fsync": bgwriter.get("buffers_backend_fsync", 0),
            "maxwritten_clean": bgwriter.get("maxwritten_clean", 0),
            "stats_reset": bgwriter.get("stats_reset", "never"),
        }

    # Invalid indexes
    invalid_idx = data.get("invalid_indexes", [])
    result.invalid_indexes = [
        {
            "schema": t.get("schema"),
            "table": t.get("table"),
            "index": t.get("index"),
        }
        for t in invalid_idx
    ]

    # WAL archiver stats
    archiver = data.get("archiver")
    if archiver:
        result.archiver = {
            "archived_count": archiver.get("archived_count", 0),
            "failed_count": archiver.get("failed_count", 0),
            "last_archived_wal": archiver.get("last_archived_wal"),
            "last_archived_time": archiver.get("last_archived_time", "never"),
            "last_failed_wal": archiver.get("last_failed_wal"),
            "last_failed_time": archiver.get("last_failed_time", "never"),
            "stats_reset": archiver.get("stats_reset", "never"),
        }

    # Vacuum progress
    progress_vac = data.get("progress_vacuum", [])
    result.progress_vacuum = [
        {
            "pid": t.get("pid"),
            "datname": t.get("datname"),
            "relname": t.get("relname"),
            "phase": t.get("phase"),
            "heap_blks_total": t.get("heap_blks_total", 0),
            "heap_blks_scanned": t.get("heap_blks_scanned", 0),
            "heap_blks_vacuumed": t.get("heap_blks_vacuumed", 0),
            "index_vacuum_count": t.get("index_vacuum_count", 0),
            "max_dead_tuples": t.get("max_dead_tuples", 0),
            "num_dead_tuples": t.get("num_dead_tuples", 0),
        }
        for t in progress_vac
    ]

    # SSL connection stats
    ssl = data.get("ssl_stats")
    if ssl:
        result.ssl_stats = {
            "ssl_connections": ssl.get("ssl_connections", 0),
            "non_ssl_connections": ssl.get("non_ssl_connections", 0),
            "ssl_versions": ssl.get("ssl_versions", []),
        }


def parse_psql_output(output: str, columns: List[str]) -> List[Dict[str, str]]:
    """Parse psql -t -A output (pipe-separated) into list of dicts."""
    rows = []
    for line in output.strip().split("\n"):
        if not line or line.startswith("("):
            continue
        values = line.split("|")
        if len(values) == len(columns):
            rows.append(dict(zip(columns, [v.strip() for v in values])))
    return rows


def get_disk_usage_from_api(environment_id: str, service_id: str) -> Optional[Dict[str, Any]]:
    """Get disk usage from Railway metrics API."""
    from datetime import timedelta

    # Build the API query
    start_date = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()

    # Use railway-api.sh script
    import os
    script_dir = os.path.dirname(os.path.abspath(__file__))
    api_script = os.path.join(script_dir, "railway-api.sh")

    if not os.path.exists(api_script):
        return None

    query = '''query metrics($environmentId: String!, $serviceId: String, $startDate: DateTime!, $measurements: [MetricMeasurement!]!) {
        metrics(environmentId: $environmentId, serviceId: $serviceId, startDate: $startDate, measurements: $measurements) {
            measurement values { ts value }
        }
    }'''

    variables = json.dumps({
        "environmentId": environment_id,
        "serviceId": service_id,
        "startDate": start_date,
        "measurements": ["DISK_USAGE_GB"]
    })

    try:
        result = subprocess.run(
            [api_script, query, variables],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode != 0:
            return None

        data = json.loads(result.stdout)
        metrics = data.get("data", {}).get("metrics", [])

        for metric in metrics:
            if metric.get("measurement") == "DISK_USAGE_GB":
                values = metric.get("values", [])
                if values:
                    # Get latest value
                    latest = values[-1].get("value", 0)
                    return {
                        "used_gb": round(latest, 2),
                        "used": f"{latest:.1f} GB",
                    }
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
        pass

    return None


def get_disk_usage(service: str, environment_id: Optional[str] = None, service_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Get disk usage - try API first, fall back to SSH."""
    # Try Railway API first
    if environment_id and service_id:
        api_result = get_disk_usage_from_api(environment_id, service_id)
        if api_result:
            return api_result

    # Fall back to SSH
    command = "df -h /var/lib/postgresql/data 2>/dev/null || df -h / | tail -1"
    code, stdout, stderr = run_ssh_query(service, command)
    if code != 0 or not stdout:
        return None

    # Parse df output: Filesystem Size Used Avail Use% Mounted
    lines = stdout.strip().split("\n")
    for line in lines:
        if line and not line.startswith("Filesystem"):
            parts = line.split()
            if len(parts) >= 5:
                return {
                    "total": parts[1],
                    "used": parts[2],
                    "available": parts[3],
                    "use_percent": parts[4].rstrip("%"),
                }
    return None


def get_cpu_memory_from_api(environment_id: str, service_id: str) -> Optional[Dict[str, Any]]:
    """Get CPU and memory usage from Railway metrics API.

    DEPRECATED: Use get_all_metrics_from_api() instead for combined disk/cpu/memory.
    """
    result = get_all_metrics_from_api(environment_id, service_id)
    if result:
        return result.get("cpu_memory")
    return None


def get_recent_errors(service: str, limit: int = 10) -> List[str]:
    """Get recent error logs (legacy - kept for backwards compat)."""
    code, stdout, stderr = run_railway_command(
        ["logs", "--service", service, "--lines", "100", "--filter", "@level:error"],
        timeout=30
    )
    if code != 0:
        return []

    errors = []
    for line in stdout.strip().split("\n")[:limit]:
        if line.strip():
            errors.append(line.strip())
    return errors


def get_cluster_logs(
    ha_cluster: Optional[Dict[str, Any]],
    environment_id: Optional[str],
    limit: int = 100
) -> List[Dict[str, Any]]:
    """Get logs from all HA cluster members via Railway API.

    For HA clusters, each member may be a separate deployment.
    This function fetches recent logs from each cluster member.
    """
    if not ha_cluster or not environment_id:
        return []

    members = ha_cluster.get("members", [])
    if not members:
        return []

    import os
    script_dir = os.path.dirname(os.path.abspath(__file__))
    api_script = os.path.join(script_dir, "railway-api.sh")

    if not os.path.exists(api_script):
        return []

    cluster_logs = []

    # Query to get deployments for the environment
    deployment_query = '''query deployments($environmentId: String!) {
        deployments(input: { environmentId: $environmentId }) {
            edges { node { id status staticUrl service { id name } } }
        }
    }'''

    try:
        result = subprocess.run(
            [api_script, deployment_query, json.dumps({"environmentId": environment_id})],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode != 0:
            return []

        data = json.loads(result.stdout)
        deployments = data.get("data", {}).get("deployments", {}).get("edges", [])

        # Find deployments that match cluster member names
        member_names = {m.get("name", "").lower() for m in members}

        for edge in deployments:
            deployment = edge.get("node", {})
            deployment_id = deployment.get("id")
            service_name = deployment.get("service", {}).get("name", "").lower()
            status = deployment.get("status")

            # Check if this deployment corresponds to a cluster member
            is_member = any(
                member_name in service_name or service_name in member_name
                for member_name in member_names
            )

            if not is_member and status != "SUCCESS":
                continue

            if not deployment_id:
                continue

            # Fetch logs for this deployment
            log_query = '''query deploymentLogs($deploymentId: String!, $limit: Int) {
                deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
                    timestamp message severity
                }
            }'''

            log_result = subprocess.run(
                [api_script, log_query, json.dumps({
                    "deploymentId": deployment_id,
                    "limit": limit
                })],
                capture_output=True,
                text=True,
                timeout=30
            )

            if log_result.returncode == 0:
                log_data = json.loads(log_result.stdout)
                logs = log_data.get("data", {}).get("deploymentLogs", [])
                if logs:
                    cluster_logs.append({
                        "member": service_name,
                        "deployment_id": deployment_id,
                        "status": status,
                        "logs": logs[-limit:],  # Last N logs
                    })

    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
        pass

    return cluster_logs


def is_postgres_ha_service(service_id: Optional[str]) -> bool:
    """Check if service is from postgres-ha template.

    Returns True if the service source repo contains 'postgres-ha',
    indicating this is part of an HA cluster that uses Patroni.
    """
    if not service_id:
        return False

    script_dir = os.path.dirname(os.path.abspath(__file__))
    api_script = os.path.join(script_dir, "railway-api.sh")

    if not os.path.exists(api_script):
        return False

    query = '''query service($id: String!) {
        service(id: $id) {
            source { repo }
        }
    }'''

    try:
        result = subprocess.run(
            [api_script, query, json.dumps({"id": service_id})],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode != 0:
            return False

        data = json.loads(result.stdout)
        repo = data.get("data", {}).get("service", {}).get("source", {}).get("repo", "")
        return "postgres-ha" in repo.lower() if repo else False
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
        return False


def analyze_postgres(service: str, timeout: int = 300, quiet: bool = False,
                     skip_logs: bool = False,
                     metrics_hours: int = 168,
                     project_id: Optional[str] = None,
                     environment_id: Optional[str] = None,
                     service_id: Optional[str] = None) -> AnalysisResult:
    """Run complete Postgres analysis with maximum data collection.

    Uses a single batched SQL query to collect all database metrics,
    minimizing SSH connections (~3 total instead of ~22).

    Args:
        skip_logs: Skip log fetching for faster analysis (~60s saved)
        metrics_hours: Hours of metrics history to fetch (default: 168, max: 168)
        project_id: Project ID (bypasses railway link config)
        environment_id: Environment ID (bypasses railway link config)
        service_id: Service ID (bypasses railway link config)
    """
    if not quiet:
        print(f"Analyzing postgres database: {service}", file=sys.stderr)

    result = AnalysisResult(
        service=service,
        db_type="postgres",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )

    # === FAST CONTEXT LOADING ===
    # Use explicit IDs if provided, otherwise read from config file (instant)
    if not quiet:
        print("  [0/5] Getting Railway context...", file=sys.stderr, flush=True)
    dal._progress_timer.start()

    if environment_id and service_id:
        # IDs passed directly — no need to read config or link
        dal._ctx = RailwayContext(project_id=project_id, environment_id=environment_id, service_id=service_id)
        if not quiet:
            print(f"        using explicit IDs (env={environment_id[:8]}..., svc={service_id[:8]}...)", file=sys.stderr, flush=True)
    else:
        # Fall back to reading railway context from local config (instant, no API call)
        railway_status = get_railway_status()
        if railway_status:
            dal._ctx = RailwayContext(
                project_id=railway_status.get("projectId"),
                environment_id=railway_status.get("environmentId"),
                service_id=railway_status.get("serviceId"),
            )
        environment_id = dal._ctx.environment_id
        service_id = dal._ctx.service_id

    # Check if this is an HA service - only call API if name suggests HA
    is_ha_service = False
    if any(hint in service.lower() for hint in ["postgres-ha", "patroni", "-ha"]):
        is_ha_service = is_postgres_ha_service(service_id)

    # Get deployment status via API (~1s) instead of CLI (~15s)
    progress(1, 5, "Fetching deployment status...", quiet)
    result.deployment_status = get_deployment_status(service, service_id=service_id)

    # === SSH PRE-CHECK WITH RETRY ===
    # SSH can be flaky — retry with increasing timeouts before giving up
    progress(2, 4, "Testing SSH connectivity...", quiet)
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

    # === PARALLEL EXECUTION OF SLOW OPERATIONS ===
    # Run metrics API, database query, and logs in parallel (~17-27s down to ~max of the three)
    progress(3, 4, "Running analysis (metrics, query, logs in parallel)...", quiet)

    analysis_query = build_analysis_query()

    # Define parallel tasks
    def task_metrics():
        """Fetch all metrics (disk, CPU, memory) in one API call."""
        if environment_id and service_id:
            return get_all_metrics_from_api(environment_id, service_id, hours=metrics_hours)
        return None

    def task_database_query():
        """Run the batched database analysis query with retry."""
        if not ssh_available:
            return (1, "", f"SSH not available: {ssh_stderr or 'connection failed'}")
        code, stdout, stderr = run_psql_query_safe(service, analysis_query, timeout=timeout)
        if code != 0:
            # Retry once — SSH sessions can drop mid-query
            if not quiet:
                print(f"        Database query failed ({stderr or 'unknown'}), retrying...", file=sys.stderr, flush=True)
            code, stdout, stderr = run_psql_query_safe(service, analysis_query, timeout=timeout)
        return (code, stdout, stderr)

    def task_logs():
        """Fetch recent logs via API (~3s)."""
        if skip_logs:
            return []
        return get_recent_logs(service, lines=LOG_LINES_DEFAULT,
                               environment_id=environment_id,
                               service_id=service_id)

    def task_ha_cluster():
        """Check HA cluster status (Patroni)."""
        if not is_ha_service:
            return "skipped_not_ha"
        if not ssh_available:
            return "skipped_no_ssh"
        code, stdout, stderr = run_ssh_query(service, "curl -s localhost:8008/cluster 2>/dev/null || echo '{}'")
        if code == 0 and stdout and stdout.strip() != "{}":
            try:
                patroni_data = json.loads(stdout)
                members = patroni_data.get("members", [])
                if members:
                    return {
                        "members": [
                            {
                                "name": m.get("name"),
                                "role": m.get("role"),
                                "state": m.get("state"),
                                "timeline": m.get("timeline"),
                                "lag": m.get("lag"),
                            }
                            for m in members
                        ]
                    }
            except json.JSONDecodeError:
                pass
        return None

    # Run all tasks in parallel
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_metrics = executor.submit(task_metrics)
        future_db = executor.submit(task_database_query)
        future_logs = executor.submit(task_logs)
        future_ha = executor.submit(task_ha_cluster)

        # Collect results
        metrics_result = future_metrics.result()
        db_result = future_db.result()
        logs_result = future_logs.result()
        ha_result = future_ha.result()

    # Process metrics result (combined disk + cpu/memory + 24h history)
    if metrics_result:
        result.disk_usage = metrics_result.get("disk_usage")
        result.cpu_memory = metrics_result.get("cpu_memory")
        result.metrics_history = metrics_result.get("metrics_history")
        result.collection_status["metrics_api"] = {"status": "success"}
    else:
        result.collection_status["metrics_api"] = {
            "status": "error",
            "error": "Metrics API returned no data"
        }

    # Process database query result
    code, stdout, stderr = db_result
    if code == 0 and stdout:
        try:
            data = json.loads(stdout.strip())
            parse_batched_analysis(data, result)
            result.collection_status["database_query"] = {"status": "success"}
        except json.JSONDecodeError as e:
            result.errors.append(f"Failed to parse batched analysis JSON: {e}")
            result.collection_status["database_query"] = {
                "status": "error",
                "error": f"JSON parse error: {e}"
            }
    else:
        error_msg = stderr or stdout or "Unknown error"
        if not ssh_available:
            error_msg = f"SSH failed after {len(ssh_attempts)} attempts: {ssh_stderr or 'connection failed'}"
        result.errors.append(f"Batched analysis query failed: {error_msg}")
        result.collection_status["database_query"] = {
            "status": "error",
            "error": error_msg
        }

    # Process HA cluster result
    if ha_result == "skipped_not_ha":
        result.ha_cluster = None
        result.collection_status["ha_cluster"] = {"status": "skipped", "reason": "not an HA service"}
    elif ha_result == "skipped_no_ssh":
        result.ha_cluster = None
        result.collection_status["ha_cluster"] = {"status": "skipped", "reason": "SSH not available"}
    elif ha_result is not None:
        result.ha_cluster = ha_result
        result.collection_status["ha_cluster"] = {"status": "success"}
    else:
        result.ha_cluster = None
        result.collection_status["ha_cluster"] = {
            "status": "error" if is_ha_service else "skipped",
            "error": "Failed to retrieve Patroni cluster data" if is_ha_service else "not an HA service"
        }

    # Process logs result
    if skip_logs:
        result.collection_status["logs_api"] = {"status": "skipped", "reason": "skip_logs flag set"}
    elif logs_result:
        result.recent_logs = logs_result
        result.collection_status["logs_api"] = {
            "status": "success",
            "lines": len(logs_result)
        }

        # Extract error logs locally
        result.recent_errors = [
            line for line in result.recent_logs
            if 'ERROR' in line.upper() or 'FATAL' in line.upper() or 'PANIC' in line.upper()
        ][:100]

        # HA cluster logs (API call) - done after parallel since it depends on ha_cluster
        if result.ha_cluster and environment_id:
            progress(4, 5, "Fetching HA cluster logs...", quiet)
            result.cluster_logs = get_cluster_logs(result.ha_cluster, environment_id, limit=5000)
    else:
        result.recent_logs = []
        result.collection_status["logs_api"] = {
            "status": "error",
            "error": "Logs API returned no data"
        }

    # Generate recommendations
    progress(5, 5, "Generating recommendations...", quiet)
    result.recommendations = generate_recommendations(result)

    if not quiet:
        total = dal._progress_timer.total_elapsed()
        print(f"Done.{total}", file=sys.stderr)

    return result


def generate_recommendations(result: AnalysisResult) -> List[Dict[str, str]]:
    """Generate recommendations based on analysis results."""
    recommendations = []

    # Collection failures — surface critical issues when SSH/introspection failed
    if result.collection_status:
        failed = {k: v for k, v in result.collection_status.items()
                  if v.get("status") in ("failed", "error")}
        ssh_sources = {"database_query", "ha_cluster"}
        ssh_failed = {k: v for k, v in failed.items() if k in ssh_sources}
        if ssh_failed:
            sources = ", ".join(ssh_failed.keys())
            errors = "; ".join(v.get("error", "unknown") for v in ssh_failed.values())
            recommendations.append({
                "severity": "critical",
                "category": "collection",
                "message": f"SSH introspection failed — unable to collect {sources}. "
                           f"Error: {errors}. "
                           f"Analysis is incomplete: connection stats, query performance, "
                           f"table bloat, and tuning parameters could not be evaluated.",
            })

    # === POSTGRESQL TUNING RECOMMENDATIONS ===
    # Based on best practices from PostgreSQL wiki and community
    if result.memory_config:
        mem = result.memory_config

        # Get system memory from CPU/memory metrics if available
        system_memory_gb = None
        if result.cpu_memory and "memory_limit_gb" in result.cpu_memory:
            # Use actual memory limit from Railway API
            system_memory_gb = result.cpu_memory["memory_limit_gb"]
        elif result.cpu_memory and "memory_gb" in result.cpu_memory:
            # Fallback: estimate total as ~2x current usage
            system_memory_gb = result.cpu_memory["memory_gb"] * 2  # rough estimate

        # shared_buffers check (should be ~25% of RAM, max ~40%)
        shared_buffers = mem.get("shared_buffers", {})
        if shared_buffers and shared_buffers.get("mb"):
            sb_mb = shared_buffers["mb"]
            # Flag if shared_buffers is very low (< 128MB) - likely default
            if sb_mb < 128:
                # Calculate recommended value based on system memory or default to 1GB
                rec_sb = "1GB"
                if system_memory_gb:
                    rec_sb_mb = int(system_memory_gb * 1024 * 0.25)
                    rec_sb = f"{rec_sb_mb}MB" if rec_sb_mb < 1024 else f"{round(rec_sb_mb/1024, 1)}GB"
                recommendations.append({
                    "priority": "immediate",
                    "issue": f"shared_buffers is only {sb_mb}MB (likely default)",
                    "action": f"Increase shared_buffers to {rec_sb} (25% of RAM)",
                    "explanation": "shared_buffers is PostgreSQL's main data cache - pages read from disk are stored here. "
                                   f"At {sb_mb}MB, your entire working set cannot fit in memory, forcing repeated disk reads. "
                                   "The rule of thumb is 25% of total RAM, up to 40% for read-heavy workloads.",
                    "commands": [
                        f"ALTER SYSTEM SET shared_buffers = '{rec_sb}';",
                        "-- Requires database restart to take effect"
                    ],
                    "restart_required": True,
                })
            elif sb_mb < 256:
                rec_sb = "512MB"
                if system_memory_gb:
                    rec_sb_mb = int(system_memory_gb * 1024 * 0.25)
                    rec_sb = f"{rec_sb_mb}MB" if rec_sb_mb < 1024 else f"{round(rec_sb_mb/1024, 1)}GB"
                recommendations.append({
                    "priority": "short-term",
                    "issue": f"shared_buffers is {sb_mb}MB - may be undersized",
                    "action": f"Consider increasing shared_buffers to {rec_sb} (25% of RAM)",
                    "explanation": "shared_buffers holds cached data pages. A larger buffer pool means more data stays in memory, "
                                   "reducing disk I/O. Current size may be limiting cache hit ratio.",
                    "commands": [
                        f"ALTER SYSTEM SET shared_buffers = '{rec_sb}';",
                        "-- Requires database restart to take effect"
                    ],
                    "restart_required": True,
                })

        # effective_cache_size check (should be 50-75% of RAM)
        effective_cache = mem.get("effective_cache_size", {})
        if effective_cache and effective_cache.get("mb"):
            ec_mb = effective_cache["mb"]
            # Flag if effective_cache_size seems low
            if ec_mb < 512:
                rec_ec = "3GB"
                if system_memory_gb:
                    rec_ec_mb = int(system_memory_gb * 1024 * 0.75)
                    rec_ec = f"{rec_ec_mb}MB" if rec_ec_mb < 1024 else f"{round(rec_ec_mb/1024, 1)}GB"
                recommendations.append({
                    "priority": "short-term",
                    "issue": f"effective_cache_size is {ec_mb}MB - may cause poor query plans",
                    "action": f"Set effective_cache_size to {rec_ec} (75% of RAM)",
                    "explanation": "effective_cache_size is a hint to the query planner about how much memory is available for caching "
                                   "(shared_buffers + OS cache). It does NOT allocate memory - it just helps PostgreSQL estimate "
                                   "whether data is likely to be cached. A low value makes the planner pessimistic, avoiding efficient "
                                   "index scans in favor of sequential scans.",
                    "commands": [
                        f"ALTER SYSTEM SET effective_cache_size = '{rec_ec}';",
                        "SELECT pg_reload_conf();  -- Takes effect immediately"
                    ],
                    "restart_required": False,
                })

        # work_mem check (per-operation memory for sorts/hashes)
        work_mem = mem.get("work_mem", {})
        if work_mem and work_mem.get("mb"):
            wm_mb = work_mem["mb"]
            # Calculate recommended work_mem based on connections and RAM
            max_conns = result.connections.get("max", 100) if result.connections else 100
            rec_wm = "32MB"
            if system_memory_gb:
                # Formula: (RAM / max_connections) / 4
                rec_wm_mb = int((system_memory_gb * 1024 / max_conns) / 4)
                rec_wm_mb = max(16, min(rec_wm_mb, 128))  # Clamp between 16-128MB
                rec_wm = f"{rec_wm_mb}MB"

            # Flag if work_mem is at default (4MB) with high temp file usage
            if result.database_stats:
                temp_files = result.database_stats.get("temp_files", 0)
                temp_bytes = result.database_stats.get("temp_bytes", 0)
                temp_gb = round(temp_bytes / 1024 / 1024 / 1024, 1) if temp_bytes > 0 else 0
                if wm_mb <= 4 and temp_files > 1000:
                    recommendations.append({
                        "priority": "immediate",
                        "issue": f"work_mem is only {wm_mb}MB with {temp_files:,} temp files ({temp_gb} GB) spilled to disk",
                        "action": f"Increase work_mem to {rec_wm}",
                        "explanation": f"work_mem controls how much memory each sort, hash, or join operation can use BEFORE "
                                       f"spilling to disk (temp files). At {wm_mb}MB, your queries are constantly spilling. "
                                       f"The {temp_files:,} temp files mean disk I/O instead of fast memory operations. "
                                       f"CAUTION: A query can use multiple work_mem allocations (one per sort node), "
                                       f"so don't set this too high. Formula: (RAM / max_connections) / 4.",
                        "commands": [
                            f"ALTER SYSTEM SET work_mem = '{rec_wm}';",
                            "SELECT pg_reload_conf();  -- Takes effect for new connections"
                        ],
                        "restart_required": False,
                    })
                elif wm_mb <= 4:
                    recommendations.append({
                        "priority": "long-term",
                        "issue": f"work_mem is at default ({wm_mb}MB)",
                        "action": f"Consider increasing work_mem to {rec_wm} for complex queries",
                        "explanation": "work_mem is memory per sort/hash operation. The default 4MB is conservative. "
                                       "Increasing it can speed up complex queries but uses more memory per operation.",
                        "commands": [
                            f"ALTER SYSTEM SET work_mem = '{rec_wm}';",
                            "SELECT pg_reload_conf();  -- Takes effect for new connections"
                        ],
                        "restart_required": False,
                    })

        # maintenance_work_mem check
        maint_mem = mem.get("maintenance_work_mem", {})
        if maint_mem and maint_mem.get("mb"):
            mm_mb = maint_mem["mb"]
            if mm_mb < 64:
                rec_mm = "256MB"
                if system_memory_gb and system_memory_gb >= 8:
                    rec_mm = "512MB"
                recommendations.append({
                    "priority": "short-term",
                    "issue": f"maintenance_work_mem is {mm_mb}MB - VACUUM and CREATE INDEX will be slow",
                    "action": f"Increase maintenance_work_mem to {rec_mm}",
                    "explanation": "maintenance_work_mem is used by VACUUM, CREATE INDEX, and ALTER TABLE operations. "
                                   f"At {mm_mb}MB, these maintenance operations process data in small batches, making them slow. "
                                   "Unlike work_mem, only one maintenance operation runs per session, so this can safely be higher.",
                    "commands": [
                        f"ALTER SYSTEM SET maintenance_work_mem = '{rec_mm}';",
                        "SELECT pg_reload_conf();  -- Takes effect immediately"
                    ],
                    "restart_required": False,
                })

        # random_page_cost check (default 4.0, should be 1.1-2.0 for SSD)
        rpc = mem.get("random_page_cost", {})
        if rpc and rpc.get("value"):
            rpc_val = float(rpc["value"])
            if rpc_val >= 4.0:
                recommendations.append({
                    "priority": "short-term",
                    "issue": f"random_page_cost is {rpc_val} (HDD default) - Railway uses SSDs",
                    "action": "Set random_page_cost to 1.5 for SSD storage",
                    "explanation": "random_page_cost tells the query planner how expensive random disk access is compared to "
                                   "sequential access. The default 4.0 assumes slow HDDs where random reads are 4x more expensive. "
                                   "Railway uses fast SSDs where random reads are almost as fast as sequential. At 4.0, "
                                   "the planner avoids index scans (random access) in favor of slower sequential scans.",
                    "commands": [
                        "ALTER SYSTEM SET random_page_cost = 1.5;",
                        "SELECT pg_reload_conf();  -- Takes effect immediately"
                    ],
                    "restart_required": False,
                })

        # checkpoint_completion_target check (should be 0.9)
        cct = mem.get("checkpoint_completion_target", {})
        if cct and cct.get("value"):
            cct_val = float(cct["value"])
            if cct_val < 0.9:
                recommendations.append({
                    "priority": "long-term",
                    "issue": f"checkpoint_completion_target is {cct_val} - I/O may be spiky",
                    "action": "Set checkpoint_completion_target to 0.9",
                    "explanation": f"PostgreSQL periodically writes dirty buffers to disk (checkpoints). At {cct_val}, "
                                   f"it tries to complete this in {int(cct_val*100)}% of the checkpoint interval, causing I/O spikes. "
                                   "At 0.9, writes spread over 90% of the interval, smoothing disk I/O. "
                                   "WHY: Spiky I/O can cause query latency spikes during checkpoints. "
                                   "SIDE EFFECT: Slightly more consistent (but spread out) disk writes. No downside in practice.",
                    "commands": [
                        "ALTER SYSTEM SET checkpoint_completion_target = 0.9;",
                        "SELECT pg_reload_conf();  -- Takes effect immediately"
                    ],
                    "restart_required": False,
                })

        # max_parallel_workers check
        mpw = mem.get("max_parallel_workers", {})
        mpwpg = mem.get("max_parallel_workers_per_gather", {})
        if mpw and mpw.get("value") == 0:
            recommendations.append({
                "priority": "short-term",
                "issue": "max_parallel_workers is 0 - parallel queries disabled",
                "action": "Set max_parallel_workers to number of CPU cores",
                "explanation": "PostgreSQL can use multiple CPU cores for large sequential scans, aggregates, and joins. "
                               "With max_parallel_workers=0, all queries run single-threaded regardless of table size. "
                               "WHY: Large analytical queries (COUNT, SUM, scans of big tables) could run 2-8x faster with parallelism. "
                               "SIDE EFFECT: Parallel queries use more CPU and memory simultaneously. For OLTP workloads with many "
                               "small queries, this rarely triggers. For analytical queries, it's a significant speedup. "
                               "IF NOT CHANGED: Large table scans will always be slow, even with idle CPU cores.",
                "commands": [
                    "ALTER SYSTEM SET max_parallel_workers = 4;  -- Adjust to your CPU count",
                    "ALTER SYSTEM SET max_parallel_workers_per_gather = 2;",
                    "SELECT pg_reload_conf();"
                ],
                "restart_required": False,
            })
        elif mpwpg and mpwpg.get("value") == 0:
            recommendations.append({
                "priority": "long-term",
                "issue": "max_parallel_workers_per_gather is 0 - parallel queries won't use workers",
                "action": "Set max_parallel_workers_per_gather to 2-4",
                "explanation": "Even though max_parallel_workers allows parallel execution, max_parallel_workers_per_gather=0 "
                               "means each query can use 0 parallel workers (i.e., none). "
                               "WHY: This effectively disables parallelism for all queries. "
                               "SIDE EFFECT: Each parallel query can use up to this many additional workers. "
                               "Setting to 2 means a query could use 3 total processes (1 leader + 2 workers). "
                               "IF NOT CHANGED: You have parallel infrastructure configured but no queries will use it.",
                "commands": [
                    "ALTER SYSTEM SET max_parallel_workers_per_gather = 2;",
                    "SELECT pg_reload_conf();"
                ],
                "restart_required": False,
            })

        # autovacuum check
        autovac = mem.get("autovacuum", {})
        if autovac and autovac.get("value") == "off":
            recommendations.append({
                "priority": "immediate",
                "issue": "autovacuum is DISABLED - database will bloat and eventually fail",
                "action": "Enable autovacuum immediately",
                "explanation": "Autovacuum is PostgreSQL's background process that reclaims space from deleted/updated rows "
                               "and prevents transaction ID wraparound. With autovacuum OFF: "
                               "1) Tables bloat indefinitely - deleted rows waste space and slow queries. "
                               "2) Transaction IDs (XIDs) are never frozen - the database WILL shut down when XIDs wrap (~2 billion transactions). "
                               "3) Table statistics become stale - query planner makes bad decisions. "
                               "WHY IT WAS DISABLED: Sometimes disabled for bulk loads, but must be re-enabled after. "
                               "IF NOT CHANGED: Database will eventually refuse all writes to prevent corruption. This is not recoverable without maintenance.",
                "commands": [
                    "ALTER SYSTEM SET autovacuum = on;",
                    "SELECT pg_reload_conf();"
                ],
                "restart_required": False,
            })

        # synchronous_commit info (not a warning, just info)
        sync = mem.get("synchronous_commit", {})
        if sync and sync.get("value") == "off":
            recommendations.append({
                "priority": "long-term",
                "issue": "synchronous_commit is off - faster writes but risk of data loss on crash",
                "action": "Evaluate if this is acceptable for your data",
                "explanation": "With synchronous_commit=off, PostgreSQL returns 'success' to clients BEFORE data is flushed to disk. "
                               "BENEFIT: Write transactions are 2-10x faster because they don't wait for disk. "
                               "RISK: If the server crashes, the last ~100-800ms of committed transactions may be lost. "
                               "The database will NOT be corrupted - it will be consistent, just missing recent commits. "
                               "ACCEPTABLE FOR: Session data, analytics, caches, logs - anything you can afford to lose. "
                               "NOT ACCEPTABLE FOR: Financial transactions, user data, anything where 'committed' must mean 'durable'. "
                               "IF NOT CHANGED: You keep the performance benefit but accept the crash-loss risk.",
            })

    # pg_stat_statements not available
    if not result.top_queries:
        recommendations.append({
            "priority": "short-term",
            "issue": "pg_stat_statements extension not available - cannot analyze query performance",
            "action": "Enable pg_stat_statements extension",
            "explanation": "pg_stat_statements tracks execution statistics for all SQL queries: call count, total time, "
                           "rows returned, cache hits, temp file usage. Without it, you cannot identify slow queries or optimization targets. "
                           "WHY: This analysis found memory/vacuum issues but cannot pinpoint which QUERIES cause problems. "
                           "SIDE EFFECT: Minor overhead (~1-5%) for tracking. Stores stats in shared memory. "
                           "IF NOT ENABLED: You're flying blind - you can see symptoms (high I/O, temp files) but not the queries causing them. "
                           "To enable, run: python3 scripts/enable-pg-stats.py --service <name> (may require brief restart).",
        })

    # Cache hit ratio
    if result.cache_hit:
        table_hit = result.cache_hit.get("table_hit_pct")
        if table_hit is not None and table_hit < 95:
            priority = "immediate" if table_hit < 90 else "short-term"
            # Find the worst offending tables for context
            worst_tables = []
            for t in result.cache_per_table[:3]:
                if float(t.get("hit_pct") or 100) < 90:
                    worst_tables.append(f"{t['table']} ({t['hit_pct']}%)")
            context = f" Worst tables: {', '.join(worst_tables)}." if worst_tables else ""
            recommendations.append({
                "priority": priority,
                "issue": f"Table cache hit ratio is {table_hit}% (should be >95%)",
                "action": "Increase shared_buffers - data is being read from disk instead of memory cache",
                "explanation": f"Cache hit ratio measures how often PostgreSQL finds requested data in memory (shared_buffers) "
                               f"vs reading from disk. At {table_hit}%, roughly {100-table_hit}% of data requests hit disk.{context}",
            })

    # Per-table cache - check for low hit rates with high disk reads
    for table in result.cache_per_table:
        try:
            hit_pct = float(table.get("hit_pct") or 100)
            disk_reads = int(table.get("disk_reads") or 0)
            table_size = table.get("size", "unknown")
        except (ValueError, TypeError):
            continue

        if hit_pct < 50 and disk_reads > 1_000_000:
            recommendations.append({
                "priority": "immediate",
                "issue": f"Table '{table['table']}' has {hit_pct}% cache hit with {disk_reads:,} disk reads",
                "action": "Increase shared_buffers to fit this table in memory",
                "explanation": f"The '{table['table']}' table ({table_size}) is almost never found in cache. "
                               f"With {disk_reads:,} disk reads, every query touching this table causes disk I/O. "
                               f"This is likely because the table is larger than shared_buffers.",
            })
        elif hit_pct < 80 and disk_reads > 10_000_000:
            recommendations.append({
                "priority": "short-term",
                "issue": f"Table '{table['table']}' has {hit_pct}% cache hit with {disk_reads:,} disk reads",
                "action": "Consider increasing shared_buffers for better caching",
                "explanation": f"The '{table['table']}' table has a low cache hit rate, causing frequent disk reads. "
                               f"Increasing shared_buffers would allow more of this table to stay in memory.",
            })

    # Memory config
    if result.memory_config and result.table_sizes:
        shared_buffers_mb = result.memory_config.get("shared_buffers", {}).get("mb", 0)
        total_table_bytes = sum(int(t.get("bytes", 0)) for t in result.table_sizes)
        total_table_mb = total_table_bytes / 1024 / 1024

        if shared_buffers_mb > 0 and total_table_mb > shared_buffers_mb * 4:
            largest_table = result.table_sizes[0] if result.table_sizes else None
            context = ""
            if largest_table:
                lt_mb = int(largest_table.get("bytes", 0)) / 1024 / 1024
                context = f" Your largest table ({largest_table['table']}) is {round(lt_mb)}MB alone."
            recommendations.append({
                "priority": "immediate",
                "issue": f"shared_buffers ({shared_buffers_mb}MB) is much smaller than working set (~{round(total_table_mb)}MB)",
                "action": f"Increase shared_buffers to at least {round(total_table_mb / 4)}MB",
                "explanation": f"Your database has ~{round(total_table_mb)}MB of table data but only {shared_buffers_mb}MB of buffer cache.{context} "
                               f"PostgreSQL cannot keep frequently-accessed data in memory, causing constant disk I/O.",
            })

    # Vacuum health (using enhanced flags)
    for table in result.vacuum_health:
        dead_pct = float(table.get("dead_pct", 0))
        dead_rows = int(table.get("dead_rows", 0))
        needs_vacuum = table.get("needs_vacuum") == "true"
        needs_freeze = table.get("needs_freeze") == "true"
        last_vacuum = table.get("last_vacuum", "never")
        last_analyze = table.get("last_analyze", "never")

        # Check needs_freeze flag first (more urgent)
        if needs_freeze:
            recommendations.append({
                "priority": "immediate",
                "issue": f"Table '{table['table']}' needs FREEZE (XID age > 150M)",
                "action": f"Run: VACUUM FREEZE \"{table['table']}\";",
                "explanation": "PostgreSQL uses transaction IDs (XIDs) that can wrap around after ~2 billion transactions. "
                               "VACUUM FREEZE marks old rows as 'frozen' so they don't need XID checking. "
                               "If XIDs wrap around without freezing, the database will shut down to prevent data corruption.",
                "commands": [f"VACUUM FREEZE \"{table['table']}\";"],
            })
        elif needs_vacuum:
            recommendations.append({
                "priority": "immediate",
                "issue": f"Table '{table['table']}' needs VACUUM ({dead_pct}% dead rows, {dead_rows:,} rows)",
                "action": f"Run: VACUUM ANALYZE \"{table['table']}\";",
                "explanation": f"This table has {dead_rows:,} dead rows ({dead_pct}% of table) from UPDATE/DELETE operations. "
                               "Dead rows waste disk space and slow down queries by making them scan more pages. "
                               f"Last vacuum: {last_vacuum}. Last analyze: {last_analyze}. "
                               "ANALYZE also updates statistics for better query plans.",
                "commands": [f"VACUUM ANALYZE \"{table['table']}\";"],
            })
        elif dead_pct > 20:
            recommendations.append({
                "priority": "immediate",
                "issue": f"Table '{table['table']}' has {dead_pct}% dead rows ({dead_rows:,} rows)",
                "action": f"Run: VACUUM ANALYZE \"{table['table']}\";",
                "explanation": f"Over 20% of this table is dead rows from UPDATEs and DELETEs. "
                               f"This bloat forces queries to scan many useless rows. Last vacuum: {last_vacuum}.",
                "commands": [f"VACUUM ANALYZE \"{table['table']}\";"],
            })
        elif dead_pct > 10:
            recommendations.append({
                "priority": "short-term",
                "issue": f"Table '{table['table']}' has {dead_pct}% dead rows ({dead_rows:,} rows)",
                "action": f"Run: VACUUM ANALYZE \"{table['table']}\";",
                "explanation": f"This table has accumulated {dead_rows:,} dead rows. While autovacuum should handle this, "
                               f"it may be falling behind. Last vacuum: {last_vacuum}.",
                "commands": [f"VACUUM ANALYZE \"{table['table']}\";"],
            })

    # XID age
    if result.xid_age:
        xid_millions = result.xid_age.get("millions", 0)
        if xid_millions > 150:
            recommendations.append({
                "priority": "immediate",
                "issue": f"XID age is {xid_millions}M (wraparound risk at 2147M)",
                "action": "Run VACUUM FREEZE on all high-XID tables",
                "explanation": "PostgreSQL's transaction ID counter wraps around at ~2.1 billion. At 150M+, you're using ~7% of "
                               "the available space. If this reaches 2 billion without VACUUM FREEZE, PostgreSQL will "
                               "shut down to prevent data corruption. This is a critical issue requiring immediate action.",
                "commands": ["VACUUM FREEZE;  -- Run on affected tables"],
            })
        elif xid_millions > 100:
            recommendations.append({
                "priority": "short-term",
                "issue": f"XID age is {xid_millions}M (approaching wraparound risk)",
                "action": "Monitor autovacuum and consider manual VACUUM FREEZE",
                "explanation": "XID age is elevated. Autovacuum should handle this, but verify it's running. "
                               "If tables are being vacuumed but XID age stays high, long-running transactions may be blocking freezing.",
            })

    # Database stats (deadlocks, temp files)
    if result.database_stats:
        deadlocks = result.database_stats.get("deadlocks", 0)
        if deadlocks > 0:
            recommendations.append({
                "priority": "short-term",
                "issue": f"{deadlocks} deadlock(s) detected since last stats reset",
                "action": "Review application transaction logic and lock ordering",
                "explanation": f"A deadlock occurs when two transactions each hold a lock the other needs, creating a cycle. "
                               f"PostgreSQL detects this and kills one transaction (the 'victim') so the other can proceed. "
                               f"WHY THIS MATTERS: {deadlocks} deadlocks means {deadlocks} transactions were aborted and had to retry. "
                               f"COMMON CAUSES: 1) Transactions locking rows in different orders. 2) Long transactions holding locks. "
                               f"3) Hot rows updated by many concurrent transactions. "
                               f"FIX: Ensure all code paths lock tables/rows in the same order. Keep transactions short. "
                               f"IF NOT FIXED: Deadlocks will continue, causing random transaction failures and retries.",
            })

        # Temp files - flag with description based on daily rate
        temp_files = result.database_stats.get("temp_files", 0)
        temp_bytes = result.database_stats.get("temp_bytes", 0)
        temp_gb = round(temp_bytes / 1024 / 1024 / 1024, 1) if temp_bytes > 0 else 0
        stats_reset = result.database_stats.get("stats_reset", "unknown")
        # Calculate days since reset for rate-based thresholds
        days_since_reset = None
        if stats_reset and stats_reset not in ("unknown", "never"):
            try:
                reset_date = datetime.fromisoformat(stats_reset.replace('Z', '+00:00'))
                days_since_reset = (datetime.now(timezone.utc) - reset_date).days
                days_since_reset = max(days_since_reset, 1)  # Avoid division by zero
            except (ValueError, TypeError):
                pass
        # Use rate-based threshold if we have time period data
        if days_since_reset and days_since_reset > 0:
            gb_per_day = temp_gb / days_since_reset
            files_per_day = round(temp_files / days_since_reset)
            if gb_per_day > 5:  # More than 5GB/day is concerning
                # Get current work_mem for context
                wm_mb = result.memory_config.get("work_mem", {}).get("mb", 4) if result.memory_config else 4
                recommendations.append({
                    "priority": "short-term",
                    "issue": f"High temp file usage: ~{files_per_day:,} files/day ({round(gb_per_day, 1)} GB/day)",
                    "action": "Increase work_mem from {wm_mb}MB to 32-64MB",
                    "explanation": f"When a query needs to sort or hash more data than work_mem allows ({wm_mb}MB), "
                                   f"PostgreSQL spills to temp files on disk. Your queries are creating ~{files_per_day:,} temp files daily, "
                                   f"writing {round(gb_per_day, 1)}GB to disk. This is slower than in-memory operations.",
                    "commands": [
                        "ALTER SYSTEM SET work_mem = '32MB';",
                        "SELECT pg_reload_conf();  -- Takes effect for new connections"
                    ],
                    "restart_required": False,
                })
        elif temp_files > 10000 or temp_gb > 10:  # Fallback if no date
            wm_mb = result.memory_config.get("work_mem", {}).get("mb", 4) if result.memory_config else 4
            recommendations.append({
                "priority": "short-term",
                "issue": f"High temp file usage: {temp_files:,} files, {temp_gb} GB written since stats reset",
                "action": f"Increase work_mem from {wm_mb}MB to 32-64MB",
                "explanation": f"Queries are spilling to disk because work_mem ({wm_mb}MB) is too small for sort/hash operations. "
                               f"Each temp file represents a query that couldn't fit its working data in memory.",
                "commands": [
                    "ALTER SYSTEM SET work_mem = '32MB';",
                    "SELECT pg_reload_conf();  -- Takes effect for new connections"
                ],
                "restart_required": False,
            })

    # Connection usage
    if result.connections:
        pct = result.connections.get("percent", 0)
        current = result.connections.get("current", 0)
        max_conn = result.connections.get("max", 100)
        available = result.connections.get("available", max_conn - current)
        if pct > 90:
            recommendations.append({
                "priority": "immediate",
                "issue": f"Connection usage is {pct}% ({current}/{max_conn}, only {available} available)",
                "action": "Use connection pooling (PgBouncer) or increase max_connections",
                "explanation": f"You're using {current} of {max_conn} connections. Each PostgreSQL connection uses memory "
                               f"(~10MB each). Rather than increasing max_connections, use connection pooling (PgBouncer) "
                               f"to multiplex many app connections over fewer database connections.",
            })
        elif pct > 70:
            recommendations.append({
                "priority": "short-term",
                "issue": f"Connection usage is {pct}% ({current}/{max_conn})",
                "action": "Consider connection pooling for scalability",
                "explanation": "Connection usage is elevated. Connection pooling (PgBouncer) helps applications share "
                               "database connections efficiently, especially during traffic spikes.",
            })

    # Old connections
    if result.oldest_connection_sec is not None:
        age_hours = result.oldest_connection_sec / 3600
        age_days = round(age_hours / 24, 1)
        if age_hours > 48:
            # Include details about what the old connections are
            conn_details = ""
            if result.oldest_connections:
                details_list = []
                for c in result.oldest_connections[:3]:
                    app = c.get("application_name") or "(unnamed)"
                    state = c.get("state", "unknown")
                    days = c.get("age_days", "?")
                    details_list.append(f"{app} ({state}, {days} days)")
                conn_details = f" Old connections: {'; '.join(details_list)}."

            recommendations.append({
                "priority": "short-term",
                "issue": f"Oldest connection is ~{age_days} days old ({round(age_hours)} hours)",
                "action": "Review connection pooling settings and application connection management",
                "explanation": f"Long-lived connections can indicate connection pool misconfiguration or connection leaks. "
                               f"They can also hold locks or prevent autovacuum from cleaning up. "
                               f"If using connection pooling, ensure idle connections are recycled.{conn_details}",
            })

    # Disk usage
    if result.disk_usage:
        use_pct = int(result.disk_usage.get("use_percent", 0))
        used = result.disk_usage.get("used", "unknown")
        total = result.disk_usage.get("total", "unknown")
        if use_pct > 85:
            recommendations.append({
                "priority": "immediate",
                "issue": f"Disk usage is {use_pct}% ({used} / {total})",
                "action": "Increase volume size or clean up data",
                "explanation": "PostgreSQL needs free disk space for WAL files, temp files, and VACUUM operations. "
                               "Running out of disk space can cause database crashes. Consider: "
                               "1) Increasing volume size, 2) Dropping unused indexes, 3) VACUUM FULL on bloated tables, "
                               "4) Archiving old data.",
            })
        elif use_pct > 70:
            recommendations.append({
                "priority": "short-term",
                "issue": f"Disk usage is {use_pct}% ({used} / {total})",
                "action": "Plan for volume expansion",
                "explanation": f"Disk is at {use_pct}%, approaching the danger zone. PostgreSQL needs free space for: "
                               f"1) WAL files - write-ahead logs that ensure durability. "
                               f"2) Temp files - sorts and hashes spill here when work_mem is exceeded. "
                               f"3) VACUUM operations - need space to rewrite tables during VACUUM FULL. "
                               f"IF NOT ADDRESSED: At 85%+ you risk write failures. At 100%, database crashes and may not restart. "
                               f"ACTIONS: Increase volume size in Railway, or identify large unused tables/indexes to drop.",
            })

    # Unused indexes - only flag non-PK, non-unique indexes >100MB
    droppable_indexes = [
        idx for idx in result.unused_indexes
        if not idx.get("is_primary") and not idx.get("is_unique")
        and int(idx.get("size_bytes", 0)) > 100 * 1024 * 1024
    ]
    if droppable_indexes:
        total_size = sum_index_sizes(droppable_indexes)
        index_names = [idx['index'] for idx in droppable_indexes[:3]]
        recommendations.append({
            "priority": "long-term",
            "issue": f"{len(droppable_indexes)} unused non-constraint indexes >100MB ({total_size})",
            "action": "Review and drop unused indexes to save space and improve write performance",
            "explanation": f"These indexes have 0 scans since stats reset, meaning no queries are using them. "
                           f"Each index costs disk space AND slows down writes (INSERT/UPDATE/DELETE must update all indexes). "
                           f"Examples: {', '.join(index_names)}{'...' if len(droppable_indexes) > 3 else ''}",
            "commands": [f"DROP INDEX IF EXISTS \"{idx['index']}\";  -- saves {idx['size']}" for idx in droppable_indexes[:3]],
        })

    # Tables with high missing index score (lots of seq scans, no index usage)
    for idx in result.unused_indexes:
        try:
            missing_score = int(idx.get("missing_index_score", 0))
            if missing_score > 1000:
                table_rows = idx.get("table_rows", "unknown")
                recommendations.append({
                    "priority": "short-term",
                    "issue": f"Table '{idx['table']}' has {missing_score:,} sequential scans with no index usage",
                    "action": f"Consider adding an index on commonly filtered columns of '{idx['table']}'",
                    "explanation": f"Sequential scans read the entire table ({table_rows} rows) for each query. "
                                   f"With {missing_score:,} sequential scans, queries are repeatedly scanning all rows. "
                                   f"An index on commonly filtered columns (WHERE clauses) would dramatically speed this up.",
                })
        except (ValueError, TypeError):
            pass

    # Long-running queries
    if result.long_running_queries:
        for q in result.long_running_queries[:3]:
            try:
                duration = int(q.get("duration_sec", 0))
                query_preview = q.get("query", "")[:80]
                if duration > 60:
                    recommendations.append({
                        "priority": "immediate",
                        "issue": f"Query running for {duration}s (PID {q.get('pid')})",
                        "action": "Investigate and potentially cancel",
                        "explanation": f"This query has been running for {duration} seconds. "
                                       f"QUERY: {query_preview}... "
                                       f"WHY THIS MATTERS: Long queries hold locks, consume memory, and may indicate missing indexes or inefficient queries. "
                                       f"TO CANCEL (graceful): SELECT pg_cancel_backend({q.get('pid')}); "
                                       f"TO TERMINATE (force): SELECT pg_terminate_backend({q.get('pid')}); "
                                       f"SIDE EFFECT OF CANCEL: The query's transaction will be rolled back. The application will receive an error.",
                        "commands": [f"SELECT pg_cancel_backend({q.get('pid')});  -- Graceful cancel"],
                    })
            except (ValueError, TypeError):
                pass

    # Idle in transaction (stuck transactions)
    if result.idle_in_transaction:
        for txn in result.idle_in_transaction[:3]:
            try:
                idle_sec = int(txn.get("idle_sec", 0))
                app_name = txn.get("application_name", "unknown app")
                if idle_sec > 300:  # 5 minutes
                    recommendations.append({
                        "priority": "immediate",
                        "issue": f"Transaction idle for {idle_sec}s (PID {txn.get('pid')}, user: {txn.get('user', 'unknown')}, app: {app_name})",
                        "action": "Terminate the stuck transaction",
                        "explanation": f"This connection started a transaction (BEGIN) but hasn't done anything for {idle_sec}s. "
                                       f"WHY THIS IS BAD: 1) Holds row-level locks that block other queries. "
                                       f"2) Prevents VACUUM from cleaning dead rows in any table it touched. "
                                       f"3) Holds a transaction ID slot, contributing to XID bloat. "
                                       f"COMMON CAUSES: Application bug, network timeout without cleanup, abandoned connection. "
                                       f"TO FIX: SELECT pg_terminate_backend({txn.get('pid')}); (terminates connection). "
                                       f"PREVENTION: Set idle_in_transaction_session_timeout to auto-kill stuck transactions.",
                        "commands": [
                            f"SELECT pg_terminate_backend({txn.get('pid')});  -- Kill this connection",
                            "ALTER SYSTEM SET idle_in_transaction_session_timeout = '5min';  -- Auto-kill in future",
                        ],
                    })
                elif idle_sec > 60:
                    recommendations.append({
                        "priority": "short-term",
                        "issue": f"Transaction idle for {idle_sec}s (PID {txn.get('pid')}, app: {app_name})",
                        "action": "Review application transaction handling",
                        "explanation": f"This transaction has been idle for {idle_sec}s. While not critical yet, "
                                       f"transactions should be short-lived. Long idle transactions hold locks and block VACUUM. "
                                       f"COMMON CAUSES: Missing COMMIT/ROLLBACK, waiting for user input inside transaction, connection pool issues. "
                                       f"PREVENTION: Use idle_in_transaction_session_timeout to auto-terminate stuck transactions.",
                    })
            except (ValueError, TypeError):
                pass

    # Blocked queries
    if result.blocked_queries:
        for q in result.blocked_queries[:3]:
            try:
                wait_sec = int(q.get("wait_sec", 0))
                if wait_sec > 30:
                    recommendations.append({
                        "priority": "immediate",
                        "issue": f"Query waiting {wait_sec}s for lock (PID {q.get('pid')} blocked by {q.get('blocking_pid')})",
                        "action": "Investigate the blocking query and terminate if appropriate",
                        "explanation": f"PID {q.get('pid')} has been waiting {wait_sec}s for a lock held by PID {q.get('blocking_pid')}. "
                                       f"WHY: The blocking query/transaction is holding a lock (row, table, or advisory) that this query needs. "
                                       f"COMMON CAUSES: Long-running transaction, idle-in-transaction, DDL operations (ALTER TABLE). "
                                       f"TO INVESTIGATE: SELECT query FROM pg_stat_activity WHERE pid = {q.get('blocking_pid')}; "
                                       f"TO UNBLOCK: Cancel or terminate the blocking PID if it's stuck. "
                                       f"SIDE EFFECT: Terminating the blocker will rollback its transaction, but unblock waiting queries.",
                        "commands": [
                            f"-- See what {q.get('blocking_pid')} is doing:",
                            f"SELECT pid, state, query FROM pg_stat_activity WHERE pid = {q.get('blocking_pid')};",
                            f"-- To terminate (if stuck): SELECT pg_terminate_backend({q.get('blocking_pid')});",
                        ],
                    })
            except (ValueError, TypeError):
                pass

    # Lock contention
    if result.locks:
        lock_types = set(lock.get("locktype", "unknown") for lock in result.locks)
        recommendations.append({
            "priority": "immediate",
            "issue": f"{len(result.locks)} blocked lock(s) detected ({', '.join(lock_types)})",
            "action": "Investigate lock contention - may indicate long transactions or deadlocks",
            "explanation": "Queries are waiting for locks held by other transactions. Common causes: "
                           "1) Long-running transactions holding locks, 2) Deadlocks (PostgreSQL will resolve these automatically), "
                           "3) DDL operations (ALTER TABLE) blocking normal queries. "
                           "Check blocked_queries and idle_in_transaction sections for details.",
        })

    # Sequential scans on large tables
    for table in result.seq_scan_tables:
        try:
            seq_scans = int(table.get("seq_scans", 0))
            idx_scans = int(table.get("idx_scans", 0))
            rows = int(table.get("rows", 0))
            if seq_scans > 1000 and idx_scans == 0 and rows > 10000:
                recommendations.append({
                    "priority": "short-term",
                    "issue": f"Table '{table['table']}' has {seq_scans:,} sequential scans with 0 index scans ({rows:,} rows)",
                    "action": "Add indexes on columns used in WHERE, JOIN, and ORDER BY clauses",
                    "explanation": f"Every query on '{table['table']}' scans all {rows:,} rows instead of using an index. "
                                   f"With {seq_scans:,} sequential scans, this table is a performance hotspot. "
                                   f"To find which columns to index, run: EXPLAIN ANALYZE on slow queries touching this table, "
                                   f"or check pg_stat_statements for common query patterns.",
                })
        except (ValueError, TypeError):
            pass

    # HA cluster issues
    if result.ha_cluster:
        members = result.ha_cluster.get("members", [])
        for m in members:
            state = m.get("state", "")
            if state == "start failed":
                recommendations.append({
                    "priority": "immediate",
                    "issue": f"HA replica '{m.get('name')}' is in 'start failed' state",
                    "action": "Resync the replica",
                    "explanation": f"The replica '{m.get('name')}' failed to start, typically due to timeline divergence. "
                                   f"This happens when the replica's WAL history diverges from the primary (e.g., after failover). "
                                   f"WHY THIS MATTERS: This replica cannot be used for failover or read scaling until fixed. "
                                   f"FIX: The replica needs a fresh base backup (pg_basebackup) from the primary. "
                                   f"IF NOT FIXED: You're running without redundancy - if the primary fails, no automatic failover is possible.",
                })
            elif state not in ("running", "streaming"):
                recommendations.append({
                    "priority": "short-term",
                    "issue": f"HA replica '{m.get('name')}' is in '{state}' state",
                    "action": "Investigate replica health",
                    "explanation": f"Expected state is 'running' or 'streaming', but replica is '{state}'. "
                                   f"POSSIBLE STATES: 'creating' (initializing), 'stopped' (manually stopped), 'start failed' (broken). "
                                   f"WHY THIS MATTERS: Non-streaming replicas may have stale data and can't be used for failover. "
                                   f"CHECK: Replica logs for specific errors. Network connectivity to primary. WAL lag.",
                })

    # Recent errors
    if result.recent_errors and len(result.recent_errors) > 5:
        # Summarize error types (recent_errors is a list of strings)
        error_samples = [e[:60] if isinstance(e, str) else str(e)[:60] for e in result.recent_errors[:3]]
        recommendations.append({
            "priority": "short-term",
            "issue": f"{len(result.recent_errors)} recent errors in logs",
            "action": "Review error logs for patterns",
            "explanation": f"Multiple errors detected in recent logs. Sample messages: {'; '.join(error_samples)}... "
                           f"WHY THIS MATTERS: Frequent errors may indicate application bugs, configuration issues, or resource constraints. "
                           f"CHECK: Look for patterns - are errors from one app? One query? Specific time periods? "
                           f"COMMON TYPES: Connection errors (app/network issue), query errors (syntax/permissions), "
                           f"out-of-memory errors (need more RAM or lower work_mem).",
        })

    # Invalid indexes
    if result.invalid_indexes:
        for idx in result.invalid_indexes:
            recommendations.append({
                "priority": "immediate",
                "issue": f"Invalid index '{idx.get('index')}' on {idx.get('schema')}.{idx.get('table')}",
                "action": "Drop and recreate the index",
                "explanation": f"This index is marked as invalid - PostgreSQL will NOT use it for queries. "
                               f"CAUSE: Usually a CREATE INDEX CONCURRENTLY that failed partway through (e.g., due to constraint violation, "
                               f"out of disk space, or duplicate key). "
                               f"WHY THIS MATTERS: The index takes up disk space and slows writes, but provides zero query benefit. "
                               f"FIX: Drop it and recreate. Use CONCURRENTLY to avoid locking the table.",
                "commands": [
                    f"DROP INDEX CONCURRENTLY IF EXISTS \"{idx.get('index')}\";",
                    f"-- Then recreate with: CREATE INDEX CONCURRENTLY ...",
                ],
            })

    # WAL archiver failures
    if result.archiver and result.archiver.get("failed_count", 0) > 0:
        last_failed_wal = result.archiver.get("last_failed_wal", "unknown")
        last_failed_time = result.archiver.get("last_failed_time", "unknown")
        recommendations.append({
            "priority": "immediate",
            "issue": f"WAL archiver has {result.archiver['failed_count']} failed archival(s)",
            "action": "Check archive_command configuration and destination storage",
            "explanation": f"WAL (Write-Ahead Log) archiving is failing. Last failed WAL: {last_failed_wal} at {last_failed_time}. "
                           f"This affects point-in-time recovery capability. Common causes: "
                           f"1) Archive destination full or unreachable, 2) Permissions issues, 3) archive_command misconfiguration.",
        })

    # Background writer issues
    if result.bgwriter:
        bg = result.bgwriter
        # High backend fsync indicates shared_buffers pressure
        if bg.get("buffers_backend_fsync", 0) > 0:
            recommendations.append({
                "priority": "short-term",
                "issue": f"Backend processes forced {bg['buffers_backend_fsync']:,} fsync operations",
                "action": "Increase shared_buffers to reduce dirty buffer pressure",
                "explanation": "Normally, the background writer or checkpointer flushes dirty buffers to disk. "
                               f"When shared_buffers is too small, backends must flush dirty buffers themselves "
                               f"(buffers_backend_fsync > 0). This forces query processes to do I/O, causing latency spikes.",
            })

        # Check if most checkpoints are requested (not timed)
        timed = bg.get("checkpoints_timed", 0)
        req = bg.get("checkpoints_req", 0)
        total = timed + req
        if total > 10 and req > timed:
            req_pct = round(100.0 * req / total, 1)
            recommendations.append({
                "priority": "short-term",
                "issue": f"{req_pct}% of checkpoints are requested (not timed) - WAL is filling up",
                "action": "Increase max_wal_size to 2-4GB",
                "explanation": f"Checkpoints should happen on a timer (checkpoint_timeout), not because WAL fills up. "
                               f"With {req_pct}% requested checkpoints, WAL segments are filling faster than expected. "
                               f"This causes I/O spikes. Increasing max_wal_size gives more headroom before forced checkpoints.",
                "commands": [
                    "ALTER SYSTEM SET max_wal_size = '2GB';",
                    "SELECT pg_reload_conf();  -- Takes effect immediately"
                ],
                "restart_required": False,
            })

        # High maxwritten_clean indicates bgwriter can't keep up
        if bg.get("maxwritten_clean", 0) > 100:
            recommendations.append({
                "priority": "long-term",
                "issue": f"Background writer hit max write limit {bg['maxwritten_clean']:,} times",
                "action": "Increase bgwriter_lru_maxpages to let bgwriter flush more buffers per round",
                "explanation": "The background writer proactively flushes dirty buffers before they're needed. "
                               f"It hit the per-round limit {bg['maxwritten_clean']:,} times, meaning it couldn't "
                               f"keep up with the write rate. Increasing bgwriter_lru_maxpages allows more buffer "
                               f"flushes per round.",
            })

    return recommendations


def sum_index_sizes(indexes: List[Dict[str, Any]]) -> str:
    """Sum up index sizes and return human-readable string."""
    total_bytes = 0
    for idx in indexes:
        size_str = idx.get("size", "0")
        # Parse sizes like "23 MB", "8448 kB", etc.
        match = re.match(r"(\d+)\s*(MB|kB|GB|bytes?)?", size_str, re.IGNORECASE)
        if match:
            value = int(match.group(1))
            unit = (match.group(2) or "bytes").upper()
            if unit in ("KB", "KB"):
                total_bytes += value * 1024
            elif unit == "MB":
                total_bytes += value * 1024 * 1024
            elif unit == "GB":
                total_bytes += value * 1024 * 1024 * 1024
            else:
                total_bytes += value

    if total_bytes >= 1024 * 1024 * 1024:
        return f"{total_bytes / 1024 / 1024 / 1024:.1f} GB"
    elif total_bytes >= 1024 * 1024:
        return f"{total_bytes / 1024 / 1024:.1f} MB"
    elif total_bytes >= 1024:
        return f"{total_bytes / 1024:.1f} KB"
    return f"{total_bytes} bytes"


def format_report(result: AnalysisResult) -> str:
    """Format analysis result as human-readable report."""
    lines = []
    lines.append("=" * 60)
    lines.append(f"Database Analysis: {result.service}")
    lines.append("=" * 60)
    lines.append(f"Type: {result.db_type}")
    lines.append(f"Generated: {result.timestamp}")
    lines.append(f"Status: {result.deployment_status}")
    lines.append("")

    # Collection status table
    if result.collection_status:
        lines.append("## Data Collection Status")
        lines.append("")
        lines.append("| Source | Status | Details |")
        lines.append("|--------|--------|---------|")
        source_labels = {
            "database_query": "Database Query (SSH)",
            "metrics_api": "Metrics API",
            "logs_api": "Logs API",
            "ha_cluster": "HA Cluster (Patroni)",
        }
        for source in ["database_query", "metrics_api", "logs_api", "ha_cluster"]:
            if source in result.collection_status:
                info = result.collection_status[source]
                status = info["status"].upper()
                details = ""
                if info.get("error"):
                    details = info["error"]
                elif info.get("reason"):
                    details = info["reason"]
                elif info.get("lines"):
                    details = f"{info['lines']} lines collected"
                elif status == "SUCCESS":
                    details = "OK"
                label = source_labels.get(source, source)
                lines.append(f"| {label} | {status} | {details} |")
        lines.append("")

    # Summary table
    lines.append("## Summary")
    lines.append("")
    lines.append("| Metric | Value | Status |")
    lines.append("|--------|-------|--------|")

    # Deployment
    status_icon = "Healthy" if result.deployment_status == "SUCCESS" else "Warning"
    lines.append(f"| Deployment | {result.deployment_status} | {status_icon} |")

    # Connections
    if result.connections:
        pct = result.connections["percent"]
        current = result.connections["current"]
        max_conn = result.connections["max"]
        reserved = result.connections.get("reserved", 3)
        available = result.connections.get("available", max_conn - current)
        active = result.connections.get("active", 0)
        idle = result.connections.get("idle", 0)
        idle_in_txn = result.connections.get("idle_in_transaction", 0)
        status = "Critical" if pct > 90 else "Warning" if pct > 70 else "Healthy"
        lines.append(f"| Connections | {current} / {max_conn} ({pct}%) | {status} |")
        lines.append(f"| - Active/Idle/IdleTxn | {active} / {idle} / {idle_in_txn} | {'Warning' if idle_in_txn > 5 else '-'} |")
        lines.append(f"| - Available | {available} (reserved: {reserved}) | - |")

    # Database size
    if result.size_breakdown and result.size_breakdown.get("database_bytes"):
        db_bytes = result.size_breakdown["database_bytes"]
        db_gb = round(db_bytes / 1024 / 1024 / 1024, 2)
        lines.append(f"| Database Size | {db_gb} GB | - |")

    # Disk
    if result.disk_usage:
        pct = int(result.disk_usage["use_percent"])
        status = "Critical" if pct > 85 else "Warning" if pct > 70 else "Healthy"
        lines.append(f"| Disk | {result.disk_usage['used']} / {result.disk_usage['total']} ({pct}%) | {status} |")

    # Cache hit
    if result.cache_hit:
        table_hit = result.cache_hit.get("table_hit_pct")
        if table_hit is not None:
            status = "Healthy" if table_hit >= 99 else "OK" if table_hit >= 95 else "Warning" if table_hit >= 90 else "Critical"
            lines.append(f"| Table Cache Hit | {table_hit}% | {status} |")

        index_hit = result.cache_hit.get("index_hit_pct")
        if index_hit is not None:
            status = "Healthy" if index_hit >= 99 else "OK" if index_hit >= 95 else "Warning"
            lines.append(f"| Index Cache Hit | {index_hit}% | {status} |")

    # Memory config summary
    if result.memory_config:
        if "shared_buffers" in result.memory_config:
            sb = result.memory_config["shared_buffers"]
            mb = sb.get("mb", 0)
            status = "Warning" if mb < 128 else "OK" if mb < 256 else "Healthy"
            lines.append(f"| shared_buffers | {mb} MB | {status} |")
        if "work_mem" in result.memory_config:
            wm = result.memory_config["work_mem"]
            mb = wm.get("mb", 0)
            status = "Default" if mb <= 4 else "OK"
            lines.append(f"| work_mem | {mb} MB | {status} |")

    # XID age
    if result.xid_age:
        millions = result.xid_age["millions"]
        status = "Critical" if millions > 150 else "Warning" if millions > 100 else "Healthy"
        lines.append(f"| XID Age | {millions}M | {status} |")

    # CPU/Memory (with trend indicators from 24h history)
    if result.cpu_memory:
        if "cpu_percent" in result.cpu_memory:
            cpu = result.cpu_memory["cpu_percent"]
            status = "Critical" if cpu > 85 else "Warning" if cpu > 70 else "Healthy"
            trend_str = _trend_indicator(result.metrics_history, "cpu")
            lines.append(f"| CPU Usage | {cpu} vCPU{trend_str} | {status} |")
            if result.cpu_memory.get("cpu_limit"):
                lines.append(f"| CPU Limit | {result.cpu_memory['cpu_limit']} vCPU | - |")
        if "memory_gb" in result.cpu_memory:
            mem = result.cpu_memory["memory_gb"]
            trend_str = _trend_indicator(result.metrics_history, "memory")
            utilization = ""
            if result.cpu_memory.get("memory_limit_gb"):
                pct = round((mem / result.cpu_memory["memory_limit_gb"]) * 100, 1)
                status = "Critical" if pct > 90 else "Warning" if pct > 80 else "Healthy"
                utilization = f" ({pct}% of {result.cpu_memory['memory_limit_gb']} GB)"
            else:
                status = "-"
            lines.append(f"| Memory Usage | {mem} GB{utilization}{trend_str} | {status} |")

    # Database stats
    if result.database_stats:
        stats_reset = result.database_stats.get("stats_reset", "unknown")
        # Calculate days since stats reset for rate calculations
        days_since_reset = None
        if stats_reset and stats_reset not in ("unknown", "never"):
            try:
                reset_date = datetime.fromisoformat(stats_reset.replace('Z', '+00:00'))
                days_since_reset = (datetime.now(timezone.utc) - reset_date).days
                days_since_reset = max(days_since_reset, 1)  # Avoid division by zero
            except (ValueError, TypeError):
                pass
        # Shorten timestamp to just date if it's a full timestamp
        stats_reset_display = stats_reset
        if stats_reset and stats_reset != "unknown" and stats_reset != "never" and len(stats_reset) > 10:
            stats_reset_display = stats_reset[:10]
        lines.append(f"| Stats Reset | {stats_reset_display} | - |")
        deadlocks = result.database_stats.get("deadlocks", 0)
        temp_files = result.database_stats.get("temp_files", 0)
        temp_bytes = result.database_stats.get("temp_bytes", 0)
        temp_gb = round(temp_bytes / 1024 / 1024 / 1024, 2) if temp_bytes > 0 else 0
        status = "Warning" if deadlocks > 0 else "Healthy"
        lines.append(f"| Deadlocks | {deadlocks} (since reset) | {status} |")
        # Show temp files with daily rate if we have time period data
        if days_since_reset:
            files_per_day = round(temp_files / days_since_reset)
            gb_per_day = round(temp_gb / days_since_reset, 2)
            # Status based on daily rate, not totals
            if gb_per_day > 5:
                temp_status = "High"
            elif gb_per_day > 1:
                temp_status = "Moderate"
            else:
                temp_status = "OK"
            lines.append(f"| Temp Files | {temp_files:,} ({temp_gb} GB) over {days_since_reset}d (~{files_per_day}/day, {gb_per_day} GB/day) | {temp_status} |")
        else:
            lines.append(f"| Temp Files | {temp_files:,} ({temp_gb} GB since reset) | - |")

    # Size breakdown
    if result.size_breakdown:
        wal_bytes = result.size_breakdown.get("wal_bytes", 0)
        wal_mb = round(wal_bytes / 1024 / 1024, 1)
        lines.append(f"| WAL Size | {wal_mb} MB | - |")

    # Oldest connection
    if result.oldest_connection_sec is not None:
        age_hrs = round(result.oldest_connection_sec / 3600, 1)
        status = "Warning" if age_hrs > 24 else "Healthy"
        lines.append(f"| Oldest Connection | {age_hrs} hrs | {status} |")

    # pg_stat_statements extension
    pss_status = "Installed" if result.pg_stat_statements_installed else "Not installed"
    pss_icon = "OK" if result.pg_stat_statements_installed else "Info"
    lines.append(f"| pg_stat_statements | {pss_status} | {pss_icon} |")

    lines.append("")

    # Infrastructure Trends (multi-window)
    if result.metrics_history and result.metrics_history.get("windows"):
        windows = result.metrics_history.get("windows", {})
        for window_label, window_data in windows.items():
            mh = window_data.get("metrics", {})
            if not mh:
                continue
            lines.append(f"## Infrastructure Trends ({window_label})")
            lines.append("")
            lines.append("| Metric | Current | Min | Max | Avg | Trend | Change |")
            lines.append("|--------|---------|-----|-----|-----|-------|--------|")
            display_order = [
                ("cpu", "CPU"),
                ("memory", "Memory"),
                ("disk", "Disk"),
                ("network_rx", "Network RX"),
                ("network_tx", "Network TX"),
            ]
            for key, label in display_order:
                if key in mh:
                    m = mh[key]
                    unit = m["unit"]
                    trend = m.get("trend", {})
                    direction = trend.get("direction", "?")
                    change = trend.get("change_pct", 0)
                    arrow = {"increasing": "^", "decreasing": "v", "stable": "~"}.get(direction, "?")
                    spike_note = ""
                    if m.get("spikes"):
                        spike_note = f" ({m['spikes']['count']} spikes)"
                    lines.append(
                        f"| {label} | {m['current']} {unit} | {m['min']} | {m['max']} | {m['avg']} | "
                        f"{arrow} {direction} | {change:+.1f}%{spike_note} |"
                    )
            lines.append("")

    # PostgreSQL Configuration (tuning parameters)
    if result.memory_config:
        lines.append("## PostgreSQL Configuration")
        lines.append("")
        lines.append("| Parameter | Value | Recommended | Status |")
        lines.append("|-----------|-------|-------------|--------|")

        mem = result.memory_config

        # Memory settings
        if "shared_buffers" in mem:
            sb = mem["shared_buffers"]
            mb = sb.get("mb", 0)
            status = "Low" if mb < 128 else "Default" if mb < 256 else "OK"
            lines.append(f"| shared_buffers | {mb} MB | 25% of RAM | {status} |")

        if "effective_cache_size" in mem:
            ec = mem["effective_cache_size"]
            mb = ec.get("mb", 0)
            status = "Low" if mb < 512 else "OK"
            lines.append(f"| effective_cache_size | {mb} MB | 50-75% of RAM | {status} |")

        if "work_mem" in mem:
            wm = mem["work_mem"]
            mb = wm.get("mb", 0)
            status = "Default" if mb <= 4 else "OK"
            lines.append(f"| work_mem | {mb} MB | 16-64 MB | {status} |")

        if "maintenance_work_mem" in mem:
            mm = mem["maintenance_work_mem"]
            mb = mm.get("mb", 0)
            status = "Low" if mb < 64 else "OK"
            lines.append(f"| maintenance_work_mem | {mb} MB | 256-1024 MB | {status} |")

        # WAL settings
        if "wal_buffers" in mem:
            wb = mem["wal_buffers"]
            mb = wb.get("mb", 0)
            lines.append(f"| wal_buffers | {mb} MB | 16 MB | OK |")

        if "checkpoint_completion_target" in mem:
            cct = mem["checkpoint_completion_target"]
            val = cct.get("value", 0)
            status = "Low" if float(val) < 0.9 else "OK"
            lines.append(f"| checkpoint_completion_target | {val} | 0.9 | {status} |")

        # Parallelism
        if "max_parallel_workers" in mem:
            mpw = mem["max_parallel_workers"]
            val = mpw.get("value", 0)
            status = "Disabled" if val == 0 else "OK"
            lines.append(f"| max_parallel_workers | {val} | CPU cores | {status} |")

        if "max_parallel_workers_per_gather" in mem:
            mpwpg = mem["max_parallel_workers_per_gather"]
            val = mpwpg.get("value", 0)
            status = "Disabled" if val == 0 else "OK"
            lines.append(f"| max_parallel_workers_per_gather | {val} | 2-4 | {status} |")

        # Planner
        if "random_page_cost" in mem:
            rpc = mem["random_page_cost"]
            val = rpc.get("value", 4.0)
            status = "HDD default" if float(val) >= 4.0 else "SSD optimized" if float(val) <= 2.0 else "OK"
            lines.append(f"| random_page_cost | {val} | 1.1-2.0 (SSD) | {status} |")

        if "default_statistics_target" in mem:
            dst = mem["default_statistics_target"]
            val = dst.get("value", 100)
            lines.append(f"| default_statistics_target | {val} | 100-500 | OK |")

        # Autovacuum
        if "autovacuum" in mem:
            av = mem["autovacuum"]
            val = av.get("value", "on")
            status = "CRITICAL" if val == "off" else "OK"
            lines.append(f"| autovacuum | {val} | on | {status} |")

        # Durability
        if "synchronous_commit" in mem:
            sc = mem["synchronous_commit"]
            val = sc.get("value", "on")
            status = "Faster (risk)" if val == "off" else "Safe"
            lines.append(f"| synchronous_commit | {val} | on (safe) | {status} |")

        lines.append("")

    # Connection states
    if result.connection_states:
        lines.append("## Connection States")
        lines.append("")
        lines.append("| State | Count |")
        lines.append("|-------|-------|")
        for s in result.connection_states:
            lines.append(f"| {s.get('state', 'unknown')} | {s.get('count', 0)} |")
        lines.append("")

    # Connections by application
    if result.connections_by_app:
        lines.append("## Connections by Application")
        lines.append("")
        lines.append("| Application | Count |")
        lines.append("|-------------|-------|")
        for c in result.connections_by_app[:10]:
            app = c.get('app', '') or '(empty)'
            lines.append(f"| {app} | {c.get('count', 0)} |")
        lines.append("")

    # Connections by age
    if result.connections_by_age:
        lines.append("## Connections by Age")
        lines.append("")
        lines.append("| Age Range | Count |")
        lines.append("|-----------|-------|")
        for c in result.connections_by_age:
            lines.append(f"| {c.get('range', '')} | {c.get('count', 0)} |")
        lines.append("")

    # Per-table cache
    if result.cache_per_table:
        lines.append("## Per-Table Cache Hit Rates")
        lines.append("")
        lines.append("| Table | Hit % | Disk Reads | Status |")
        lines.append("|-------|-------|------------|--------|")
        for t in result.cache_per_table[:10]:
            hit_pct = float(t.get("hit_pct", 0))
            status = "OK" if hit_pct >= 95 else "Warning" if hit_pct >= 80 else "Critical"
            lines.append(f"| {t['table']} | {t['hit_pct']}% | {int(t['disk_reads']):,} | {status} |")
        lines.append("")

    # Table sizes
    if result.table_sizes:
        lines.append("## Table Sizes")
        lines.append("")
        lines.append("| Schema.Table | Total | Data | Indexes | Rows |")
        lines.append("|--------------|-------|------|---------|------|")
        for t in result.table_sizes[:10]:
            schema = t.get('schema', 'public')
            table = t.get('table', '')
            full_name = f"{schema}.{table}" if schema != 'public' else table
            data_bytes = int(t.get('data_bytes', 0))
            index_bytes = int(t.get('index_bytes', 0))
            data_mb = round(data_bytes / 1024 / 1024, 1)
            index_mb = round(index_bytes / 1024 / 1024, 1)
            row_count = t.get('row_count', '0')
            lines.append(f"| {full_name} | {t['size']} | {data_mb}MB | {index_mb}MB | {row_count} |")
        lines.append("")

    # Vacuum health
    if result.vacuum_health:
        lines.append("## Vacuum Health")
        lines.append("")
        lines.append("| Schema.Table | Dead Rows | Dead % | V/AV Count | Last Analyze | XID Age | Flags |")
        lines.append("|--------------|-----------|--------|------------|--------------|---------|-------|")
        for t in result.vacuum_health[:10]:
            schema = t.get('schema', 'public')
            table = t.get('table', '')
            vacuum_count = t.get('vacuum_count', '0')
            autovacuum_count = t.get('autovacuum_count', '0')
            last_analyze = t.get('last_analyze', 'never')
            # Shorten timestamp to just date
            if last_analyze and last_analyze != 'never' and len(last_analyze) > 10:
                last_analyze = last_analyze[:10]
            xid_age = t.get('xid_age', '0')
            xid_millions = round(int(xid_age) / 1_000_000, 1) if xid_age.isdigit() else 0
            flags = []
            if t.get('needs_vacuum') == 'true':
                flags.append('VACUUM')
            if t.get('needs_freeze') == 'true':
                flags.append('FREEZE')
            flags_str = ', '.join(flags) if flags else '-'
            full_name = f"{schema}.{table}" if schema != 'public' else table
            lines.append(f"| {full_name} | {int(t['dead_rows']):,} | {t['dead_pct']}% | {vacuum_count}/{autovacuum_count} | {last_analyze} | {xid_millions}M | {flags_str} |")
        lines.append("")

    # Unused indexes
    if result.unused_indexes:
        lines.append("## Unused Indexes (0 scans since stats reset)")
        lines.append("")
        lines.append("| Schema.Table | Index | Size | Type | Table Idx Scans |")
        lines.append("|--------------|-------|------|------|-----------------|")
        for t in result.unused_indexes[:20]:
            schema = t.get('schema', 'public')
            table = t.get('table', '')
            full_name = f"{schema}.{table}" if schema != 'public' else table
            table_idx_scans = t.get('table_idx_scans', '0')
            # Show index type
            idx_type = "PK" if t.get('is_primary') else "UNIQUE" if t.get('is_unique') else "idx"
            lines.append(f"| {full_name} | {t['index']} | {t['size']} | {idx_type} | {table_idx_scans} |")
        lines.append("")

    # Invalid indexes (failed concurrent index builds)
    if result.invalid_indexes:
        lines.append("## Invalid Indexes (require rebuild)")
        lines.append("")
        lines.append("| Schema | Table | Index |")
        lines.append("|--------|-------|-------|")
        for t in result.invalid_indexes:
            lines.append(f"| {t.get('schema', '')} | {t.get('table', '')} | {t.get('index', '')} |")
        lines.append("")

    # Top queries
    if result.top_queries:
        lines.append("## Top Queries by Execution Time")
        lines.append("")
        lines.append("| Query | Calls | Total (min) | Mean (ms) | Min/Max (ms) | Stddev | Rows/Call | Cache Hit % | Temp R/W | Plan (ms) | I/O Time (ms) |")
        lines.append("|-------|-------|-------------|-----------|--------------|--------|-----------|-------------|----------|-----------|---------------|")
        for t in result.top_queries[:15]:
            query = t.get('query', '')[:50]
            cache_pct = t.get('cache_hit_pct')
            cache_str = f"{cache_pct}%" if cache_pct is not None else "-"
            temp_r = t.get('temp_blks_read', 0)
            temp_w = t.get('temp_blks_written', 0)
            temp_str = f"{temp_r:,}/{temp_w:,}" if (temp_r or temp_w) else "-"
            min_max = f"{t.get('min_ms', '-')}/{t.get('max_ms', '-')}"
            stddev = t.get('stddev_ms', '-')
            rows_per_call = t.get('rows_per_call', '-')
            plan_ms = t.get('mean_plan_ms', '-')
            blk_read = float(t.get('blk_read_time_ms', 0) or 0)
            blk_write = float(t.get('blk_write_time_ms', 0) or 0)
            io_time = f"{blk_read + blk_write:.0f}" if (blk_read + blk_write) > 0 else "-"
            lines.append(f"| {query}... | {t.get('calls', '')} | {t.get('total_min', '')} | {t.get('mean_ms', '')} | {min_max} | {stddev} | {rows_per_call} | {cache_str} | {temp_str} | {plan_ms} | {io_time} |")
        lines.append("")

    # Long-running queries
    if result.long_running_queries:
        lines.append("## Long-Running Queries (>5s)")
        lines.append("")
        lines.append("| PID | Duration (s) | Query |")
        lines.append("|-----|--------------|-------|")
        for q in result.long_running_queries:
            lines.append(f"| {q.get('pid', '')} | {q.get('duration_sec', '')} | {q.get('query', '')[:40]}... |")
        lines.append("")

    # Idle in transaction (stuck transactions)
    if result.idle_in_transaction:
        lines.append("## Idle In Transaction (>30s)")
        lines.append("")
        lines.append("| PID | Idle (s) | User | App | Last Query |")
        lines.append("|-----|----------|------|-----|------------|")
        for txn in result.idle_in_transaction:
            lines.append(f"| {txn.get('pid', '')} | {txn.get('idle_sec', '')} | {txn.get('user', '')} | {txn.get('app', '')[:15]} | {txn.get('last_query', '')[:30]}... |")
        lines.append("")

    # Blocked queries
    if result.blocked_queries:
        lines.append("## Blocked Queries (waiting on locks)")
        lines.append("")
        lines.append("| PID | Wait (s) | User | Blocked By | Query |")
        lines.append("|-----|----------|------|------------|-------|")
        for q in result.blocked_queries:
            lines.append(f"| {q.get('pid', '')} | {q.get('wait_sec', '')} | {q.get('user', '')} | PID {q.get('blocking_pid', '')} | {q.get('query', '')[:30]}... |")
        lines.append("")

    # Lock contention
    if result.locks:
        lines.append("## Lock Contention")
        lines.append("")
        lines.append("| Lock Type | Mode | User | App | Query |")
        lines.append("|-----------|------|------|-----|-------|")
        for lock in result.locks:
            lines.append(f"| {lock.get('locktype', '')} | {lock.get('mode', '')} | {lock.get('user', '')} | {lock.get('app', '')[:15]} | {lock.get('query', '')[:25]}... |")
        lines.append("")

    # Sequential scan patterns
    if result.seq_scan_tables:
        lines.append("## Tables with High Sequential Scans")
        lines.append("")
        lines.append("| Table | Seq Scans | Index Scans | Rows |")
        lines.append("|-------|-----------|-------------|------|")
        for t in result.seq_scan_tables[:10]:
            lines.append(f"| {t.get('table', '')} | {t.get('seq_scans', '')} | {t.get('idx_scans', '')} | {t.get('rows', '')} |")
        lines.append("")

    # Replication
    if result.replication:
        lines.append("## Replication Status")
        lines.append("")
        lines.append("| Client | State | Sent LSN | Replay LSN |")
        lines.append("|--------|-------|----------|------------|")
        for r in result.replication:
            lines.append(f"| {r.get('client', '')} | {r.get('state', '')} | {r.get('sent_lsn', '')} | {r.get('replay_lsn', '')} |")
        lines.append("")

    # HA Cluster
    if result.ha_cluster:
        lines.append("## HA Cluster (Patroni)")
        lines.append("")
        members = result.ha_cluster.get("members", [])
        if members:
            lines.append("| Name | Role | State | Timeline | Lag |")
            lines.append("|------|------|-------|----------|-----|")
            for m in members:
                lag = m.get('lag', 0) or 0
                lines.append(f"| {m.get('name', '')} | {m.get('role', '')} | {m.get('state', '')} | {m.get('timeline', '')} | {lag} |")
        lines.append("")

    # Cluster logs (for HA clusters) - raw output for LLM analysis
    if result.cluster_logs:
        lines.append("## Cluster Member Logs")
        lines.append("")
        lines.append("(Use --json for full log data. LLM will analyze patterns.)")
        lines.append("")
        for member_log in result.cluster_logs:
            member = member_log.get('member', 'unknown')
            status = member_log.get('status', 'unknown')
            logs = member_log.get('logs', [])
            lines.append(f"### {member} ({status}) - {len(logs)} log entries collected")
            lines.append("")

    # Background writer stats
    if result.bgwriter:
        lines.append("## Background Writer Stats")
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        bg = result.bgwriter
        total_checkpoints = bg.get('checkpoints_timed', 0) + bg.get('checkpoints_req', 0)
        timed_pct = round(100.0 * bg.get('checkpoints_timed', 0) / total_checkpoints, 1) if total_checkpoints > 0 else 0
        lines.append(f"| Checkpoints (timed/requested) | {bg.get('checkpoints_timed', 0):,} / {bg.get('checkpoints_req', 0):,} ({timed_pct}% timed) |")
        lines.append(f"| Buffers: checkpoint | {bg.get('buffers_checkpoint', 0):,} |")
        lines.append(f"| Buffers: bgwriter clean | {bg.get('buffers_clean', 0):,} |")
        lines.append(f"| Buffers: backend direct | {bg.get('buffers_backend', 0):,} |")
        lines.append(f"| Buffers: backend fsync | {bg.get('buffers_backend_fsync', 0):,} |")
        lines.append(f"| Max written clean | {bg.get('maxwritten_clean', 0):,} |")
        stats_reset = bg.get('stats_reset', 'never')
        if stats_reset and stats_reset != 'never' and len(stats_reset) > 10:
            stats_reset = stats_reset[:10]
        lines.append(f"| Stats reset | {stats_reset} |")
        lines.append("")

    # WAL archiver stats
    if result.archiver:
        arch = result.archiver
        lines.append("## WAL Archiver Status")
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        lines.append(f"| Archived WAL count | {arch.get('archived_count', 0):,} |")
        lines.append(f"| Failed archival count | {arch.get('failed_count', 0):,} |")
        last_wal = arch.get('last_archived_wal') or 'none'
        last_time = arch.get('last_archived_time', 'never')
        if last_time and last_time != 'never' and len(last_time) > 19:
            last_time = last_time[:19]
        lines.append(f"| Last archived WAL | {last_wal} |")
        lines.append(f"| Last archived time | {last_time} |")
        if arch.get('failed_count', 0) > 0:
            failed_wal = arch.get('last_failed_wal') or 'none'
            failed_time = arch.get('last_failed_time', 'never')
            if failed_time and failed_time != 'never' and len(failed_time) > 19:
                failed_time = failed_time[:19]
            lines.append(f"| Last failed WAL | {failed_wal} |")
            lines.append(f"| Last failed time | {failed_time} |")
        lines.append("")

    # Vacuum progress (ongoing vacuums)
    if result.progress_vacuum:
        lines.append("## Ongoing Vacuum Operations")
        lines.append("")
        lines.append("| PID | Table | Phase | Progress |")
        lines.append("|-----|-------|-------|----------|")
        for vac in result.progress_vacuum:
            total = vac.get('heap_blks_total', 0)
            scanned = vac.get('heap_blks_scanned', 0)
            pct = round(100.0 * scanned / total, 1) if total > 0 else 0
            lines.append(f"| {vac.get('pid', '')} | {vac.get('relname', '')} | {vac.get('phase', '')} | {pct}% ({scanned:,}/{total:,} blks) |")
        lines.append("")

    # SSL connection stats
    if result.ssl_stats:
        ssl = result.ssl_stats
        lines.append("## SSL Connection Stats")
        lines.append("")
        total = ssl.get('ssl_connections', 0) + ssl.get('non_ssl_connections', 0)
        ssl_pct = round(100.0 * ssl.get('ssl_connections', 0) / total, 1) if total > 0 else 0
        lines.append(f"- SSL connections: {ssl.get('ssl_connections', 0)} ({ssl_pct}%)")
        lines.append(f"- Non-SSL connections: {ssl.get('non_ssl_connections', 0)}")
        versions = ssl.get('ssl_versions', [])
        if versions:
            lines.append("- SSL versions in use:")
            for v in versions:
                lines.append(f"  - {v.get('version', 'unknown')}: {v.get('count', 0)} connections")
        lines.append("")

    # Recent errors
    if result.recent_errors:
        lines.append("## Recent Errors")
        lines.append("")
        for error in result.recent_errors[:5]:
            lines.append(f"- {error[:100]}...")
        lines.append("")

    # Recommendations
    if result.recommendations:
        lines.append("## Recommendations")
        lines.append("")
        for i, rec in enumerate(result.recommendations, 1):
            priority = rec["priority"].upper()
            lines.append(f"{i}. **[{priority}]** {rec['issue']}")
            lines.append(f"   **Action:** {rec['action']}")

            # Show explanation if available
            if rec.get("explanation"):
                lines.append(f"   **Why:** {rec['explanation']}")

            # Show commands if available
            if rec.get("commands"):
                lines.append("   **Commands:**")
                for cmd in rec["commands"]:
                    lines.append(f"   ```sql")
                    lines.append(f"   {cmd}")
                    lines.append(f"   ```")

            # Note if restart is required
            if rec.get("restart_required"):
                lines.append("   ⚠️ *Requires database restart*")

            lines.append("")

    # Errors
    if result.errors:
        lines.append("## Errors")
        lines.append("")
        for error in result.errors:
            lines.append(f"- {error}")
        lines.append("")

    lines.append("=" * 60)
    lines.append("END OF REPORT")
    lines.append("=" * 60)

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Complete database analysis for Railway services.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument("--service", required=True, help="Service name")
    parser.add_argument("--json", action="store_true",
                       help="Output as JSON")
    parser.add_argument("--timeout", type=int, default=300,
                       help="Timeout in seconds for analysis query (default: 300)")
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
    result = analyze_postgres(args.service, timeout=args.timeout, quiet=args.quiet,
                              skip_logs=args.skip_logs,
                              metrics_hours=min(args.metrics_hours, 168),
                              project_id=args.project_id,
                              environment_id=args.environment_id,
                              service_id=args.service_id)

    # Output
    if args.json:
        print(json.dumps(asdict(result), indent=2))
    else:
        print(format_report(result))

    return 0


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
        print(f"Running analysis query on: {service}", file=sys.stderr)
        query = build_analysis_query()
        code, stdout, stderr = run_psql_query_safe(service, query, timeout=args.timeout)
        print(f"Exit code: {code}")
        if code == 0 and stdout:
            try:
                data = json.loads(stdout.strip())
                print(json.dumps(data, indent=2))
            except json.JSONDecodeError:
                print(f"Raw output:\n{stdout}")
        else:
            print(f"Error: {stderr or stdout}")
        return code

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


if __name__ == "__main__":
    sys.exit(main())

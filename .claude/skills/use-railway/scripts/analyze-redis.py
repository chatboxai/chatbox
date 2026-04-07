#!/usr/bin/env python3
"""
Redis analysis for Railway deployments.

Produces a comprehensive report covering:
- Server overview (version, uptime, clients)
- Memory usage and fragmentation
- Throughput and command stats
- Cache performance (hit/miss ratio)
- Persistence status
- Keyspace summary
- Railway infrastructure metrics (CPU, memory, disk, network)
- Recent logs
- Recommendations

Usage:
    analyze-redis.py --service <name>
    analyze-redis.py --service <name> --json
    analyze-redis.py --service <name> --step ssh-test
"""

import argparse
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
    _init_context, progress, run_railway_command, run_ssh_query,
    get_railway_status, get_deployment_status,
    get_all_metrics_from_api, _analyze_window, _build_metrics_history,
    get_recent_logs,
    _safe_int, _safe_float, _format_uptime,
)


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class RedisAnalysisResult:
    """Container for Redis analysis results."""
    service: str
    db_type: str
    timestamp: str
    deployment_status: str = "UNKNOWN"

    # Redis INFO sections
    overview: Optional[Dict[str, Any]] = None
    memory: Optional[Dict[str, Any]] = None
    throughput: Optional[Dict[str, Any]] = None
    cache: Optional[Dict[str, Any]] = None
    persistence: Optional[Dict[str, Any]] = None
    keyspace: List[Dict[str, Any]] = field(default_factory=list)
    total_keys: int = 0
    command_stats: List[Dict[str, Any]] = field(default_factory=list)
    slowlog_len: Optional[int] = None
    slowlog_entries: List[Dict[str, Any]] = field(default_factory=list)
    big_keys: List[Dict[str, Any]] = field(default_factory=list)

    # Railway infrastructure
    metrics_history: Optional[Dict[str, Any]] = None
    recent_logs: List[str] = field(default_factory=list)

    # Status tracking
    collection_status: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    recommendations: List[Dict[str, str]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Redis data collection
# ---------------------------------------------------------------------------

def parse_redis_info(raw: str) -> Dict[str, str]:
    """Parse Redis INFO output into a flat key:value dict.

    Lines starting with # are section headers and are skipped.
    """
    info: Dict[str, str] = {}
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" in line:
            key, _, value = line.partition(":")
            info[key.strip()] = value.strip()
    return info


def extract_overview(info: Dict[str, str]) -> Dict[str, Any]:
    """Extract overview metrics from INFO dict."""
    return {
        "redis_version": info.get("redis_version", "unknown"),
        "uptime_in_seconds": _safe_int(info.get("uptime_in_seconds")),
        "connected_clients": _safe_int(info.get("connected_clients")),
        "blocked_clients": _safe_int(info.get("blocked_clients")),
        "rejected_connections": _safe_int(info.get("rejected_connections")),
    }


def extract_memory(info: Dict[str, str]) -> Dict[str, Any]:
    """Extract memory metrics from INFO dict."""
    return {
        "used_memory_human": info.get("used_memory_human", "N/A"),
        "used_memory_rss_human": info.get("used_memory_rss_human", "N/A"),
        "used_memory_peak_human": info.get("used_memory_peak_human", "N/A"),
        "mem_fragmentation_ratio": _safe_float(info.get("mem_fragmentation_ratio")),
        "maxmemory": _safe_int(info.get("maxmemory")),
        "maxmemory_human": info.get("maxmemory_human", "N/A"),
        "maxmemory_policy": info.get("maxmemory_policy", "unknown"),
    }


def extract_throughput(info: Dict[str, str]) -> Dict[str, Any]:
    """Extract throughput metrics from INFO dict."""
    return {
        "instantaneous_ops_per_sec": _safe_int(info.get("instantaneous_ops_per_sec")),
        "total_commands_processed": _safe_int(info.get("total_commands_processed")),
        "total_connections_received": _safe_int(info.get("total_connections_received")),
    }


def extract_cache(info: Dict[str, str]) -> Dict[str, Any]:
    """Extract cache performance metrics from INFO dict."""
    hits = _safe_int(info.get("keyspace_hits"))
    misses = _safe_int(info.get("keyspace_misses"))
    total = hits + misses
    hit_rate = round(hits / total * 100, 2) if total > 0 else 0.0
    return {
        "keyspace_hits": hits,
        "keyspace_misses": misses,
        "hit_rate": hit_rate,
        "expired_keys": _safe_int(info.get("expired_keys")),
        "evicted_keys": _safe_int(info.get("evicted_keys")),
    }


def extract_persistence(info: Dict[str, str]) -> Dict[str, Any]:
    """Extract persistence metrics from INFO dict."""
    return {
        "rdb_last_save_time": _safe_int(info.get("rdb_last_save_time")),
        "rdb_last_bgsave_status": info.get("rdb_last_bgsave_status", "unknown"),
        "rdb_current_bgsave_time_sec": _safe_int(info.get("rdb_current_bgsave_time_sec")),
        "aof_enabled": info.get("aof_enabled", "0") == "1",
        "aof_last_rewrite_status": info.get("aof_last_rewrite_status", "unknown"),
    }


def extract_keyspace(info: Dict[str, str]) -> Tuple[List[Dict[str, Any]], int]:
    """Extract keyspace metrics from INFO dict.

    Keyspace entries look like: db0:keys=1234,expires=567,avg_ttl=12345
    Returns (list of db dicts, total_keys).
    """
    databases: List[Dict[str, Any]] = []
    total_keys = 0
    for key, value in info.items():
        if not re.match(r'^db\d+$', key):
            continue
        # Parse keys=X,expires=Y,avg_ttl=Z
        parts = {}
        for item in value.split(","):
            k, _, v = item.partition("=")
            parts[k] = v
        keys = _safe_int(parts.get("keys"))
        total_keys += keys
        databases.append({
            "db": key,
            "keys": keys,
            "expires": _safe_int(parts.get("expires")),
            "avg_ttl": _safe_int(parts.get("avg_ttl")),
        })
    return databases, total_keys


def extract_command_stats(info: Dict[str, str]) -> List[Dict[str, Any]]:
    """Extract command statistics from INFO dict.

    Command stat entries look like: cmdstat_GET:calls=123,usec=456,usec_per_call=3.71
    Returns list sorted by calls descending.
    """
    stats: List[Dict[str, Any]] = []
    for key, value in info.items():
        if not key.startswith("cmdstat_"):
            continue
        cmd_name = key[len("cmdstat_"):]
        parts = {}
        for item in value.split(","):
            k, _, v = item.partition("=")
            parts[k] = v
        stats.append({
            "command": cmd_name,
            "calls": _safe_int(parts.get("calls")),
            "usec": _safe_int(parts.get("usec")),
            "usec_per_call": _safe_float(parts.get("usec_per_call")),
        })
    stats.sort(key=lambda x: x["calls"], reverse=True)
    return stats


_CLIENT_IP_RE = re.compile(r'^(\[.+\]|(?:\d{1,3}\.){3}\d{1,3}):\d+$')


def parse_slowlog_get(raw: str) -> List[Dict[str, Any]]:
    """Parse SLOWLOG GET output into structured entries.

    redis-cli --raw SLOWLOG GET format (Redis 4.0+):
      <id>
      <timestamp_unix>
      <duration_us>
      <cmd>
      <arg1>
      ...
      <argN>
      <client_ip:port>
      [<client_name>]   (optional, may be absent)

    There is no num_args field in the raw output. The client IP line
    (IPv4 or IPv6 with port) marks the end of each entry's arguments.
    """
    entries: List[Dict[str, Any]] = []
    lines = [l.strip() for l in raw.strip().splitlines() if l.strip()]
    if not lines:
        return entries

    i = 0
    while i < len(lines):
        try:
            entry_id = int(lines[i])
        except (ValueError, IndexError):
            i += 1
            continue

        if i + 3 >= len(lines):
            break

        try:
            timestamp = int(lines[i + 1])
            duration_us = int(lines[i + 2])
        except (ValueError, IndexError):
            i += 1
            continue

        # lines[i+3] is the command name; scan forward for client IP
        cmd_start = i + 3
        client_ip_pos = None
        for k in range(cmd_start, min(cmd_start + 30, len(lines))):
            if _CLIENT_IP_RE.match(lines[k]):
                client_ip_pos = k
                break

        if client_ip_pos is not None:
            cmd_parts = lines[cmd_start:client_ip_pos]
            # Advance past client IP and optional client name
            next_i = client_ip_pos + 1
            if next_i < len(lines):
                try:
                    int(lines[next_i])
                except ValueError:
                    next_i += 1  # skip client name
        else:
            # No client IP found — take command + first arg only and advance
            cmd_parts = lines[cmd_start:cmd_start + 2]
            next_i = cmd_start + 2

        command = " ".join(cmd_parts) if cmd_parts else "unknown"
        if len(command) > 120:
            command = command[:117] + "..."

        entries.append({
            "id": entry_id,
            "timestamp_unix": timestamp,
            "duration_us": duration_us,
            "command": command,
        })

        i = next_i

    return entries


def parse_bigkeys(raw: str) -> List[Dict[str, Any]]:
    """Parse redis-cli --bigkeys output into structured entries.

    Looks for lines like:
      Biggest string found "cache:render:page/dashboard" has 2145832 bytes
      Biggest hash found "user:sessions" has 14291 fields
      Biggest list found "queue:notifications" has 8402 items
      Biggest set found "tags:all" has 291 members
      Biggest zset found "leaderboard:global" has 10042 members
      Biggest stream found "events:main" has 5012 entries
    """
    entries: List[Dict[str, Any]] = []
    # Match: Biggest <type> found "<key>" has <count> <unit>
    # Redis 8+ uses double quotes; older versions used single quotes
    pattern = re.compile(
        r'Biggest\s+(\w+)\s+found\s+["\']([^"\']+)["\']\s+has\s+([\d,]+)\s+(\w+)',
        re.IGNORECASE,
    )
    for line in raw.splitlines():
        m = pattern.search(line)
        if m:
            key_type = m.group(1).lower()
            key_name = m.group(2)
            size_str = m.group(3).replace(",", "")
            unit = m.group(4).lower()
            size = _safe_int(size_str)

            # Format size for display
            if unit == "bytes":
                detail = _format_bytes_human(size)
            else:
                detail = f"{size:,} {unit}"

            entries.append({
                "type": key_type,
                "key": key_name,
                "size_or_count": size,
                "detail": detail,
            })
    return entries


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def _format_number(n: int) -> str:
    """Format a large number with K/M/B suffixes."""
    if n >= 1_000_000_000:
        return f"{n / 1_000_000_000:.1f}B"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return f"{n:,}"


def _format_duration(seconds: int) -> str:
    """Format a duration in seconds to a human-readable relative string."""
    if seconds <= 0:
        return "N/A"
    if seconds < 60:
        return f"{seconds}s ago"
    if seconds < 3600:
        return f"{seconds // 60}m ago"
    if seconds < 86400:
        return f"{seconds // 3600}h ago"
    return f"{seconds // 86400}d ago"


def _format_ttl(ms: int) -> str:
    """Format average TTL in milliseconds to a human-readable string."""
    if ms <= 0:
        return "none"
    seconds = ms // 1000
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m"
    if seconds < 86400:
        return f"{seconds // 3600}h"
    return f"{seconds // 86400}d"


def _format_usec(usec: float) -> str:
    """Format microseconds to a human-readable string."""
    if usec < 1000:
        return f"{usec:.1f}us"
    if usec < 1_000_000:
        return f"{usec / 1000:.1f}ms"
    return f"{usec / 1_000_000:.2f}s"


def _format_total_time(usec: int) -> str:
    """Format total microseconds to a readable time string."""
    seconds = usec / 1_000_000
    if seconds < 1:
        return f"{usec / 1000:.1f}ms"
    if seconds < 60:
        return f"{seconds:.1f}s"
    if seconds < 3600:
        return f"{seconds / 60:.1f}m"
    return f"{seconds / 3600:.1f}h"


def _format_bytes_human(nbytes: int) -> str:
    """Format bytes into human-readable string."""
    if nbytes <= 0:
        return "0"
    for unit in ["B", "K", "M", "G", "T"]:
        if nbytes < 1024:
            return f"{nbytes:.1f}{unit}" if nbytes != int(nbytes) else f"{int(nbytes)}{unit}"
        nbytes /= 1024
    return f"{nbytes:.1f}P"


# ---------------------------------------------------------------------------
# Recommendations engine
# ---------------------------------------------------------------------------

def generate_recommendations(result: RedisAnalysisResult) -> List[Dict[str, str]]:
    """Generate recommendations based on collected metrics."""
    recs: List[Dict[str, str]] = []

    # Collection failures — surface critical issues when SSH/introspection failed
    if result.collection_status:
        failed = {k: v for k, v in result.collection_status.items() if v.get("status") == "failed"}
        ssh_sources = {"redis_info", "slowlog", "slowlog_entries", "big_keys"}
        ssh_failed = {k: v for k, v in failed.items() if k in ssh_sources}
        if ssh_failed:
            sources = ", ".join(ssh_failed.keys())
            errors = "; ".join(v.get("error", "unknown") for v in ssh_failed.values())
            recs.append({
                "severity": "critical",
                "category": "collection",
                "message": f"SSH introspection failed — unable to collect {sources}. "
                           f"Error: {errors}. "
                           f"Analysis is incomplete: memory fragmentation, cache hit rate, "
                           f"keyspace stats, and persistence health could not be evaluated.",
            })

    # Memory fragmentation
    if result.memory:
        frag = result.memory.get("mem_fragmentation_ratio", 0)
        if frag > 1.5:
            recs.append({
                "severity": "warning",
                "category": "memory",
                "message": f"High memory fragmentation ({frag:.2f}). Consider restarting Redis to defragment, or enable activedefrag.",
            })

    # Cache hit rate
    if result.cache:
        hit_rate = result.cache.get("hit_rate", 0)
        if hit_rate < 80 and (result.cache.get("keyspace_hits", 0) + result.cache.get("keyspace_misses", 0)) > 0:
            recs.append({
                "severity": "warning",
                "category": "cache",
                "message": f"Low cache hit rate ({hit_rate:.1f}%). Review key access patterns - many keys may be expired or evicted before use.",
            })
        elif hit_rate < 95 and hit_rate >= 80:
            recs.append({
                "severity": "info",
                "category": "cache",
                "message": f"Cache hit rate at {hit_rate:.1f}% — could be improved. Check if working set fits in memory.",
            })

    # Evicted keys
    if result.cache:
        evicted = result.cache.get("evicted_keys", 0)
        if evicted > 0:
            recs.append({
                "severity": "warning",
                "category": "memory",
                "message": f"Redis is evicting keys ({_format_number(evicted)} evicted). Increase maxmemory or reduce dataset size.",
            })

    # Rejected connections
    if result.overview:
        rejected = result.overview.get("rejected_connections", 0)
        if rejected > 0:
            recs.append({
                "severity": "warning",
                "category": "connections",
                "message": f"Connections being rejected ({_format_number(rejected)}). Check maxclients setting.",
            })

    # Blocked clients
    if result.overview:
        blocked = result.overview.get("blocked_clients", 0)
        if blocked > 0:
            recs.append({
                "severity": "info",
                "category": "connections",
                "message": f"Blocked clients detected ({blocked}). Check for blocking operations (BLPOP, BRPOP, etc.).",
            })

    # maxmemory not set — on Railway this is expected; autoscaling handles growth

    # RDB save failure
    if result.persistence:
        rdb_status = result.persistence.get("rdb_last_bgsave_status", "")
        if rdb_status and rdb_status != "ok":
            recs.append({
                "severity": "critical",
                "category": "persistence",
                "message": "Last RDB save failed. Check disk space and permissions.",
            })

    # Slow log — data-driven when entries are available
    if result.slowlog_entries:
        # Analyze the actual slow commands
        total_entries = len(result.slowlog_entries)
        cmd_counts: Dict[str, int] = {}
        total_duration = 0
        for entry in result.slowlog_entries:
            cmd = entry["command"].split()[0] if entry["command"] else "unknown"
            cmd_counts[cmd] = cmd_counts.get(cmd, 0) + 1
            total_duration += entry["duration_us"]
        top_cmd = max(cmd_counts, key=cmd_counts.get) if cmd_counts else "unknown"
        top_count = cmd_counts.get(top_cmd, 0)
        avg_duration = total_duration / total_entries if total_entries > 0 else 0

        msg = (f"Slow log contains {result.slowlog_len or total_entries} entries. "
               f"Of the {total_entries} most recent: {top_count} are {top_cmd} commands "
               f"averaging {_format_usec(avg_duration)}.")
        if result.big_keys:
            big_key_types = ", ".join(f"{bk['type']} ({bk['detail']})" for bk in result.big_keys[:3])
            msg += f" Largest keys: {big_key_types} — check if these correlate with slow commands."
        severity = "warning" if (result.slowlog_len or 0) > 100 else "info"
        recs.append({"severity": severity, "category": "performance", "message": msg})
    elif result.slowlog_len is not None and result.slowlog_len > 100:
        recs.append({
            "severity": "warning",
            "category": "performance",
            "message": f"High number of slow log entries ({result.slowlog_len}). Slow log details could not be collected.",
        })

    # Big keys — standalone recommendation when no slowlog correlation
    if result.big_keys and not result.slowlog_entries:
        big_key_summary = "; ".join(f"{bk['key']} ({bk['type']}: {bk['detail']})" for bk in result.big_keys[:5])
        recs.append({
            "severity": "info",
            "category": "performance",
            "message": f"Largest keys by type: {big_key_summary}. Large keys can cause latency spikes on read/delete operations.",
        })

    return recs


# ---------------------------------------------------------------------------
# Report formatting
# ---------------------------------------------------------------------------

def format_report(result: RedisAnalysisResult) -> str:
    """Format the analysis result as a markdown report."""
    lines: List[str] = []

    lines.append(f"# Redis Analysis: {result.service}")
    lines.append(f"Timestamp: {result.timestamp}")
    lines.append(f"Deployment Status: {result.deployment_status}")
    lines.append("")

    # --- Overview ---
    if result.overview:
        o = result.overview
        lines.append("## Overview")
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        lines.append(f"| Version | {o.get('redis_version', 'N/A')} |")
        lines.append(f"| Uptime | {_format_uptime(o.get('uptime_in_seconds', 0))} |")
        lines.append(f"| Connected Clients | {o.get('connected_clients', 0):,} |")
        lines.append(f"| Blocked Clients | {o.get('blocked_clients', 0):,} |")
        lines.append(f"| Rejected Connections | {o.get('rejected_connections', 0):,} |")
        lines.append(f"| Total Keys | {result.total_keys:,} |")
        lines.append("")

    # --- Memory ---
    if result.memory:
        m = result.memory
        lines.append("## Memory")
        lines.append("| Metric | Value | Status |")
        lines.append("|--------|-------|--------|")

        frag = m.get("mem_fragmentation_ratio", 0)
        frag_status = "OK" if 1.0 <= frag <= 1.5 else ("HIGH" if frag > 1.5 else "LOW")

        lines.append(f"| Used Memory | {m.get('used_memory_human', 'N/A')} | |")
        lines.append(f"| RSS Memory | {m.get('used_memory_rss_human', 'N/A')} | |")
        lines.append(f"| Peak Memory | {m.get('used_memory_peak_human', 'N/A')} | |")
        lines.append(f"| Fragmentation Ratio | {frag:.2f} | {frag_status} |")

        maxmem = m.get("maxmemory", 0)
        if maxmem > 0:
            lines.append(f"| Max Memory | {m.get('maxmemory_human', _format_bytes_human(maxmem))} | |")
        else:
            lines.append("| Max Memory | Unlimited | |")

        lines.append(f"| Eviction Policy | {m.get('maxmemory_policy', 'N/A')} | |")
        lines.append("")

    # --- Throughput ---
    if result.throughput:
        t = result.throughput
        lines.append("## Throughput")
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        lines.append(f"| Ops/sec | {t.get('instantaneous_ops_per_sec', 0):,} |")
        lines.append(f"| Total Commands | {_format_number(t.get('total_commands_processed', 0))} |")
        lines.append(f"| Total Connections | {_format_number(t.get('total_connections_received', 0))} |")
        if result.slowlog_len is not None:
            lines.append(f"| Slow Log Entries | {result.slowlog_len:,} |")
        lines.append("")

    # --- Cache Performance ---
    if result.cache:
        c = result.cache
        hit_rate = c.get("hit_rate", 0)
        hit_status = "OK" if hit_rate >= 95 else ("WARN" if hit_rate >= 80 else "LOW")
        evicted = c.get("evicted_keys", 0)
        evict_status = "OK" if evicted == 0 else "WARN"

        lines.append("## Cache Performance")
        lines.append("| Metric | Value | Status |")
        lines.append("|--------|-------|--------|")
        lines.append(f"| Hit Rate | {hit_rate:.1f}% | {hit_status} |")
        lines.append(f"| Hits | {_format_number(c.get('keyspace_hits', 0))} | |")
        lines.append(f"| Misses | {_format_number(c.get('keyspace_misses', 0))} | |")
        lines.append(f"| Expired Keys | {_format_number(c.get('expired_keys', 0))} | |")
        lines.append(f"| Evicted Keys | {_format_number(evicted)} | {evict_status} |")
        lines.append("")

    # --- Persistence ---
    if result.persistence:
        p = result.persistence
        rdb_status = p.get("rdb_last_bgsave_status", "unknown")
        rdb_status_display = "OK" if rdb_status == "ok" else "FAIL"

        lines.append("## Persistence")
        lines.append("| Metric | Value | Status |")
        lines.append("|--------|-------|--------|")

        rdb_last_save = p.get("rdb_last_save_time", 0)
        if rdb_last_save > 0:
            now_epoch = int(datetime.now(timezone.utc).timestamp())
            save_ago = now_epoch - rdb_last_save
            lines.append(f"| RDB Last Save | {_format_duration(save_ago)} | |")
        else:
            lines.append("| RDB Last Save | never | |")

        lines.append(f"| RDB Status | {rdb_status} | {rdb_status_display} |")
        lines.append(f"| AOF Enabled | {'Yes' if p.get('aof_enabled') else 'No'} | |")

        if p.get("aof_enabled"):
            aof_status = p.get("aof_last_rewrite_status", "unknown")
            aof_display = "OK" if aof_status == "ok" else aof_status
            lines.append(f"| AOF Rewrite Status | {aof_status} | {aof_display} |")

        lines.append("")

    # --- Command Stats ---
    if result.command_stats:
        top_n = result.command_stats[:20]
        lines.append("## Command Stats (top 20)")
        lines.append("| Command | Calls | Avg Latency | Total Time |")
        lines.append("|---------|-------|-------------|------------|")
        for cs in top_n:
            lines.append(
                f"| {cs['command']} "
                f"| {_format_number(cs['calls'])} "
                f"| {_format_usec(cs['usec_per_call'])} "
                f"| {_format_total_time(cs['usec'])} |"
            )
        lines.append("")

    # --- Slow Log Entries ---
    if result.slowlog_entries:
        lines.append("## Slow Log Entries (recent)")
        lines.append("| # | Timestamp | Duration | Command |")
        lines.append("|---|-----------|----------|---------|")
        now_epoch = int(datetime.now(timezone.utc).timestamp())
        for entry in result.slowlog_entries:
            age = now_epoch - entry["timestamp_unix"]
            lines.append(
                f"| {entry['id']} "
                f"| {_format_duration(age)} "
                f"| {_format_usec(entry['duration_us'])} "
                f"| {entry['command']} |"
            )
        lines.append("")

    # --- Biggest Keys ---
    if result.big_keys:
        lines.append("## Biggest Keys")
        lines.append("| Type | Key | Size/Count |")
        lines.append("|------|-----|------------|")
        for bk in result.big_keys:
            lines.append(
                f"| {bk['type']} "
                f"| {bk['key']} "
                f"| {bk['detail']} |"
            )
        lines.append("")

    # --- Keyspace ---
    if result.keyspace:
        lines.append("## Keyspace")
        lines.append("| Database | Keys | Expires | Avg TTL |")
        lines.append("|----------|------|---------|---------|")
        for db in result.keyspace:
            lines.append(
                f"| {db['db']} "
                f"| {db['keys']:,} "
                f"| {db['expires']:,} "
                f"| {_format_ttl(db['avg_ttl'])} |"
            )
        lines.append("")

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

    # --- Collection Status ---
    if result.collection_status:
        failed = {k: v for k, v in result.collection_status.items() if v.get("status") == "failed"}
        if failed:
            lines.append("## Collection Issues")
            for source, status in failed.items():
                lines.append(f"- **{source}**: {status.get('error', 'unknown error')}")
            lines.append("")

    # --- Recommendations ---
    if result.recommendations:
        lines.append("## Recommendations")
        for rec in result.recommendations:
            severity = rec.get("severity", "info").upper()
            lines.append(f"- [{severity}] {rec['message']}")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main analysis function
# ---------------------------------------------------------------------------

def analyze_redis(service: str, timeout: int = 300, quiet: bool = False,
                  skip_logs: bool = False,
                  metrics_hours: int = 168,
                  project_id: Optional[str] = None,
                  environment_id: Optional[str] = None,
                  service_id: Optional[str] = None) -> RedisAnalysisResult:
    """Run complete Redis analysis with maximum data collection.

    Collects Redis INFO ALL, SLOWLOG LEN, SLOWLOG GET 20, --bigkeys,
    Railway metrics, and logs in parallel where possible.

    Args:
        skip_logs: Skip log fetching for faster analysis
        metrics_hours: Hours of metrics history to fetch (default: 168, max: 168)
        project_id: Project ID (bypasses railway link config)
        environment_id: Environment ID (bypasses railway link config)
        service_id: Service ID (bypasses railway link config)
    """
    if not quiet:
        print(f"Analyzing redis database: {service}", file=sys.stderr)

    result = RedisAnalysisResult(
        service=service,
        db_type="redis",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )

    # === FAST CONTEXT LOADING ===
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

    # Get deployment status via API (~1s)
    progress(1, 5, "Fetching deployment status...", quiet)
    result.deployment_status = get_deployment_status(service, service_id=service_id)

    # === SSH PRE-CHECK WITH RETRY ===
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
    progress(3, 5, "Running analysis (Redis INFO, slowlog, bigkeys, metrics, logs in parallel)...", quiet)

    def task_redis_info():
        """Fetch Redis INFO ALL via SSH."""
        if not ssh_available:
            return ("failed", f"SSH not available: {ssh_stderr or 'connection failed'}", "")
        command = 'timeout 30s redis-cli -h localhost -p 6379 -a "$REDISPASSWORD" --no-auth-warning --raw INFO ALL'
        code, stdout, stderr = run_ssh_query(service, command, timeout=45)
        if code == 0 and stdout.strip():
            return ("ok", "", stdout)
        return ("failed", stderr or "empty response", stdout)

    def task_slowlog():
        """Fetch Redis SLOWLOG LEN via SSH."""
        if not ssh_available:
            return ("failed", f"SSH not available: {ssh_stderr or 'connection failed'}", "")
        command = 'timeout 30s redis-cli -h localhost -p 6379 -a "$REDISPASSWORD" --no-auth-warning --raw SLOWLOG LEN'
        code, stdout, stderr = run_ssh_query(service, command, timeout=45)
        if code == 0 and stdout.strip():
            return ("ok", "", stdout.strip())
        return ("failed", stderr or "empty response", "")

    def task_slowlog_get():
        """Fetch Redis SLOWLOG GET 20 via SSH for actual slow query details."""
        if not ssh_available:
            return ("failed", f"SSH not available: {ssh_stderr or 'connection failed'}", "")
        command = 'timeout 30s redis-cli -h localhost -p 6379 -a "$REDISPASSWORD" --no-auth-warning --raw SLOWLOG GET 20'
        code, stdout, stderr = run_ssh_query(service, command, timeout=45)
        if code == 0 and stdout.strip():
            return ("ok", "", stdout.strip())
        return ("failed", stderr or "empty response", "")

    def task_bigkeys():
        """Fetch redis-cli --bigkeys via SSH (SCAN-based, may take longer)."""
        if not ssh_available:
            return ("failed", f"SSH not available: {ssh_stderr or 'connection failed'}", "")
        command = 'timeout 60s redis-cli -h localhost -p 6379 -a "$REDISPASSWORD" --no-auth-warning --bigkeys'
        code, stdout, stderr = run_ssh_query(service, command, timeout=75)
        if code == 0 and stdout.strip():
            return ("ok", "", stdout.strip())
        return ("failed", stderr or "empty response", "")

    def task_metrics():
        """Fetch all metrics (disk, CPU, memory) in one API call."""
        if environment_id and service_id:
            return get_all_metrics_from_api(environment_id, service_id, hours=metrics_hours)
        return None

    def task_logs():
        """Fetch recent logs via API (~3s)."""
        if skip_logs:
            return []
        return get_recent_logs(service, lines=LOG_LINES_DEFAULT,
                               environment_id=environment_id,
                               service_id=service_id)

    with ThreadPoolExecutor(max_workers=6) as executor:
        future_info = executor.submit(task_redis_info)
        future_slowlog = executor.submit(task_slowlog)
        future_slowlog_get = executor.submit(task_slowlog_get)
        future_bigkeys = executor.submit(task_bigkeys)
        future_metrics = executor.submit(task_metrics)
        future_logs = executor.submit(task_logs)

        # Collect results
        info_result = future_info.result()
        slowlog_result = future_slowlog.result()
        slowlog_get_result = future_slowlog_get.result()
        bigkeys_result = future_bigkeys.result()
        metrics_result = future_metrics.result()
        logs_result = future_logs.result()

    # === PROCESS RESULTS ===
    progress(4, 5, "Processing results...", quiet)

    # Redis INFO ALL
    info_status, info_error, info_raw = info_result
    if info_status == "ok" and info_raw:
        result.collection_status["redis_info"] = {"status": "ok"}
        info = parse_redis_info(info_raw)

        result.overview = extract_overview(info)
        result.memory = extract_memory(info)
        result.throughput = extract_throughput(info)
        result.cache = extract_cache(info)
        result.persistence = extract_persistence(info)
        result.keyspace, result.total_keys = extract_keyspace(info)
        result.command_stats = extract_command_stats(info)
    else:
        result.collection_status["redis_info"] = {"status": "failed", "error": info_error}
        result.errors.append(f"Redis INFO failed: {info_error}")

    # SLOWLOG LEN
    sl_status, sl_error, sl_raw = slowlog_result
    if sl_status == "ok" and sl_raw:
        result.collection_status["slowlog"] = {"status": "ok"}
        result.slowlog_len = _safe_int(sl_raw)
    else:
        result.collection_status["slowlog"] = {"status": "failed", "error": sl_error}

    # SLOWLOG GET 20
    slg_status, slg_error, slg_raw = slowlog_get_result
    if slg_status == "ok" and slg_raw:
        result.collection_status["slowlog_entries"] = {"status": "ok"}
        result.slowlog_entries = parse_slowlog_get(slg_raw)
    else:
        result.collection_status["slowlog_entries"] = {"status": "failed", "error": slg_error}

    # Big keys
    bk_status, bk_error, bk_raw = bigkeys_result
    if bk_status == "ok" and bk_raw:
        result.collection_status["big_keys"] = {"status": "ok"}
        result.big_keys = parse_bigkeys(bk_raw)
    else:
        result.collection_status["big_keys"] = {"status": "failed", "error": bk_error}

    # Metrics
    if metrics_result:
        result.collection_status["metrics"] = {"status": "ok"}
        result.metrics_history = metrics_result.get("metrics_history")
    else:
        result.collection_status["metrics"] = {"status": "failed", "error": "no metrics returned"}

    # Logs
    if logs_result:
        result.collection_status["logs"] = {"status": "ok", "lines": len(logs_result)}
        result.recent_logs = logs_result
    else:
        result.collection_status["logs"] = {"status": "failed", "error": "no logs returned"}

    # === RECOMMENDATIONS ===
    progress(5, 5, "Generating recommendations...", quiet)
    result.recommendations = generate_recommendations(result)

    if not quiet:
        elapsed = dal._progress_timer.step_elapsed()
        if elapsed:
            print(f"        done{elapsed}", file=sys.stderr, flush=True)
        print(f"  Analysis complete{dal._progress_timer.total_elapsed()}", file=sys.stderr, flush=True)

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
        print(f"Running Redis INFO ALL on: {service}", file=sys.stderr)
        command = 'timeout 30s redis-cli -h localhost -p 6379 -a "$REDISPASSWORD" --no-auth-warning --raw INFO ALL'
        code, stdout, stderr = run_ssh_query(service, command, timeout=45)
        print(f"Exit code: {code}")
        if code == 0 and stdout:
            info = parse_redis_info(stdout)
            print(json.dumps(info, indent=2))
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
                print("No metrics returned", file=sys.stderr)
                return 1
        else:
            print("No environment_id or service_id available", file=sys.stderr)
            return 1
        return 0

    else:
        print(f"Unknown step: {args.step}", file=sys.stderr)
        return 1


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Redis analysis for Railway services.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument("--service", required=True, help="Service name")
    parser.add_argument("--json", action="store_true",
                       help="Output as JSON")
    parser.add_argument("--timeout", type=int, default=300,
                       help="Timeout in seconds for analysis (default: 300)")
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
    result = analyze_redis(args.service, timeout=args.timeout, quiet=args.quiet,
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


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
MongoDB analysis for Railway deployments.

Produces a comprehensive report covering:
- Deployment status & overview
- Connections & operations
- Latency (opLatencies)
- Memory & WiredTiger cache
- Storage & collection stats
- Replication / oplog
- Slow queries & active operations
- Top collections by activity
- Recommendations

Usage:
    analyze-mongo.py --service <name>
    analyze-mongo.py --service <name> --json
    analyze-mongo.py --service <name> --step ssh-test
"""

import argparse
import json
import os
import subprocess
import sys
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
    _trend_indicator,
)


# ---------------------------------------------------------------------------
# Result container
# ---------------------------------------------------------------------------

@dataclass
class MongoAnalysisResult:
    """Container for MongoDB analysis results."""
    service: str
    db_type: str
    timestamp: str
    deployment_status: str = "UNKNOWN"

    # Server overview
    version: Optional[str] = None
    storage_engine: Optional[str] = None
    uptime_seconds: Optional[int] = None

    # Connections
    connections: Optional[Dict[str, Any]] = None

    # Operations
    opcounters: Optional[Dict[str, Any]] = None
    opcounters_repl: Optional[Dict[str, Any]] = None

    # Latency
    op_latencies: Optional[Dict[str, Any]] = None

    # Memory
    memory: Optional[Dict[str, Any]] = None
    page_faults: Optional[int] = None

    # Network
    network: Optional[Dict[str, Any]] = None

    # WiredTiger
    wiredtiger_cache: Optional[Dict[str, Any]] = None
    wiredtiger_checkpoint: Optional[Dict[str, Any]] = None
    wiredtiger_tickets: Optional[Dict[str, Any]] = None

    # Global lock
    global_lock: Optional[Dict[str, Any]] = None

    # Document metrics
    document_metrics: Optional[Dict[str, Any]] = None

    # Query efficiency
    query_executor: Optional[Dict[str, Any]] = None

    # Plan cache (7.0+)
    plan_cache: Optional[Dict[str, Any]] = None

    # Sort (7.0+)
    sort_metrics: Optional[Dict[str, Any]] = None

    # Cursors
    cursors: Optional[Dict[str, Any]] = None

    # TTL
    ttl_metrics: Optional[Dict[str, Any]] = None

    # Asserts
    asserts: Optional[Dict[str, Any]] = None

    # Replication
    replication: Optional[Dict[str, Any]] = None
    oplog: Optional[Dict[str, Any]] = None

    # Storage (db.stats)
    storage: Optional[Dict[str, Any]] = None

    # Collection stats
    collection_stats: List[Dict[str, Any]] = field(default_factory=list)

    # Top collections
    top_collections: Optional[List[Dict[str, Any]]] = None

    # Slow queries
    slow_queries: List[Dict[str, Any]] = field(default_factory=list)

    # Active operations
    active_ops: List[Dict[str, Any]] = field(default_factory=list)

    # Logs
    recent_logs: List[str] = field(default_factory=list)
    recent_errors: List[str] = field(default_factory=list)

    # Railway metrics (CPU, memory, disk, network trends)
    cpu_memory: Optional[Dict[str, Any]] = None
    disk_usage: Optional[Dict[str, Any]] = None
    metrics_history: Optional[Dict[str, Any]] = None

    # Status tracking
    collection_status: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    recommendations: List[Dict[str, str]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# MongoDB-specific helpers
# ---------------------------------------------------------------------------

def run_mongosh_query(service: str, js_expr: str, timeout: int = 30) -> Tuple[int, str, str]:
    """Run a mongosh query via SSH and return (returncode, stdout, stderr).

    The query is wrapped in EJSON.stringify and executed through mongosh
    connecting to the local MongoDB instance using container env vars.
    """
    # Escape single quotes in the JS expression for the shell
    escaped = js_expr.replace("'", "'\\''")
    command = (
        f'''bash +H -c 'mongosh "mongodb://$MONGOUSER:$MONGOPASSWORD@localhost:27017" '''
        f'''--quiet --norc --eval "EJSON.stringify({escaped})"' '''
    )
    return run_ssh_query(service, command, timeout)



# ---------------------------------------------------------------------------
# MongoDB queries
# ---------------------------------------------------------------------------

QUERY_SERVER_STATUS = """(function(){ var s = db.serverStatus(); return { connections: s.connections, opcounters: s.opcounters, opcountersRepl: s.opcountersRepl || null, repl: s.repl || null, mem: s.mem, network: s.network, uptime: s.uptime, opLatencies: s.opLatencies, wiredTiger: s.wiredTiger ? { cache: s.wiredTiger.cache, concurrentTransactions: s.wiredTiger.concurrentTransactions, transaction: s.wiredTiger.transaction || null } : null, globalLock: s.globalLock, metrics: s.metrics ? { document: s.metrics.document, queryExecutor: s.metrics.queryExecutor, cursor: s.metrics.cursor, ttl: s.metrics.ttl || null, query: s.metrics.query || null } : null, extra_info: s.extra_info ? { page_faults: s.extra_info.page_faults } : null, version: s.version, storageEngine: s.storageEngine, asserts: s.asserts }; })()"""

QUERY_DB_STATS = """db.stats()"""

QUERY_CURRENT_OP = """db.currentOp({ active: true })"""

QUERY_COLLECTION_STATS = """db.getCollectionNames().map(function(c) { var s = db.getCollection(c).stats(); return { name: c, count: s.count || 0, size: s.size || 0, storageSize: s.storageSize || 0, indexSize: s.totalIndexSize || 0, nindexes: s.nindexes || 0 }; })"""

QUERY_SLOW_QUERIES = """(function(){ try { var logs = db.system.profile.find().sort({ts: -1}).limit(10).toArray(); return logs.map(function(l) { return { op: l.op, ns: l.ns, millis: l.millis, ts: l.ts, command: JSON.stringify(l.command || l.query || {}).substring(0, 200), planSummary: l.planSummary || '' }; }); } catch(e) { return []; } })()"""

QUERY_REPL_INFO = """(function(){ try { var info = db.getReplicationInfo(); return { logSizeMB: info.logSizeMB, usedMB: info.usedMB, timeDiffHours: info.timeDiffHours }; } catch(e) { return null; } })()"""

QUERY_TOP = """(function(){ try { var t = db.adminCommand({top:1}); var totals = t.totals; var result = []; for (var ns in totals) { if (ns.indexOf('.') > 0 && ns.indexOf('system.') === -1) { var c = totals[ns]; result.push({ ns: ns, reads: c.readLock ? c.readLock.count : 0, readTimeUs: c.readLock ? c.readLock.time : 0, writes: c.writeLock ? c.writeLock.count : 0, writeTimeUs: c.writeLock ? c.writeLock.time : 0 }); } } return result; } catch(e) { return null; } })()"""


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _safe_json(raw: str) -> Any:
    """Parse JSON from mongosh EJSON output, returning None on failure."""
    raw = raw.strip()
    if not raw:
        return None
    # mongosh may emit warnings before the JSON; find the first { or [
    for i, ch in enumerate(raw):
        if ch in ('{', '['):
            raw = raw[i:]
            break
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _parse_server_status(data: Dict[str, Any], result: MongoAnalysisResult) -> None:
    """Extract metrics from serverStatus into result."""
    # Overview
    result.version = data.get("version")
    se = data.get("storageEngine")
    if se:
        result.storage_engine = se.get("name")
    result.uptime_seconds = data.get("uptime")

    # Connections
    conn = data.get("connections")
    if conn:
        result.connections = {
            "current": conn.get("current", 0),
            "available": conn.get("available", 0),
            "totalCreated": conn.get("totalCreated", 0),
        }

    # Opcounters
    result.opcounters = data.get("opcounters")
    result.opcounters_repl = data.get("opcountersRepl")

    # Replication info from serverStatus
    repl = data.get("repl")
    if repl:
        result.replication = {
            "setName": repl.get("setName"),
            "isWritablePrimary": repl.get("isWritablePrimary"),
            "primary": repl.get("primary"),
            "hosts": repl.get("hosts"),
        }

    # Latency
    lat = data.get("opLatencies")
    if lat:
        result.op_latencies = {}
        for key in ("reads", "writes", "commands"):
            entry = lat.get(key, {})
            ops = entry.get("ops", 0)
            latency = entry.get("latency", 0)
            result.op_latencies[key] = {
                "latency": latency,
                "ops": ops,
                "avg_us": round(latency / ops, 1) if ops > 0 else 0,
            }

    # Memory
    mem = data.get("mem")
    if mem:
        result.memory = {
            "resident_mb": mem.get("resident", 0),
            "virtual_mb": mem.get("virtual", 0),
        }

    extra = data.get("extra_info")
    if extra:
        result.page_faults = extra.get("page_faults", 0)

    # Network
    net = data.get("network")
    if net:
        result.network = {
            "bytesIn": net.get("bytesIn", 0),
            "bytesOut": net.get("bytesOut", 0),
            "numRequests": net.get("numRequests", 0),
        }

    # WiredTiger
    wt = data.get("wiredTiger")
    if wt:
        cache = wt.get("cache", {})
        result.wiredtiger_cache = {
            "bytes_in_cache": cache.get("bytes currently in the cache", 0),
            "max_bytes": cache.get("maximum bytes configured", 0),
            "dirty_bytes": cache.get("tracked dirty bytes in the cache", 0),
            "pages_read": cache.get("pages read into cache", 0),
            "pages_written": cache.get("pages written from cache", 0),
            "app_evictions": cache.get("pages evicted by application threads", 0),
        }

        txn = wt.get("transaction", {})
        if txn:
            result.wiredtiger_checkpoint = {
                "most_recent_time_ms": txn.get("transaction checkpoint most recent time (msecs)", 0),
            }

        ct = wt.get("concurrentTransactions", {})
        if ct:
            read_info = ct.get("read", {})
            write_info = ct.get("write", {})
            result.wiredtiger_tickets = {
                "read_available": read_info.get("available", 0),
                "read_total": read_info.get("totalTickets", 0),
                "write_available": write_info.get("available", 0),
                "write_total": write_info.get("totalTickets", 0),
            }

    # Global lock
    gl = data.get("globalLock")
    if gl:
        cq = gl.get("currentQueue", {})
        ac = gl.get("activeClients", {})
        result.global_lock = {
            "queue_readers": cq.get("readers", 0),
            "queue_writers": cq.get("writers", 0),
            "active_readers": ac.get("readers", 0),
            "active_writers": ac.get("writers", 0),
        }

    # Metrics
    metrics = data.get("metrics")
    if metrics:
        doc = metrics.get("document")
        if doc:
            result.document_metrics = {
                "inserted": doc.get("inserted", 0),
                "updated": doc.get("updated", 0),
                "deleted": doc.get("deleted", 0),
                "returned": doc.get("returned", 0),
            }

        qe = metrics.get("queryExecutor")
        if qe:
            result.query_executor = {
                "scanned": qe.get("scanned", 0),
                "scannedObjects": qe.get("scannedObjects", 0),
            }

        cursor = metrics.get("cursor")
        if cursor:
            open_cursors = cursor.get("open", {})
            result.cursors = {
                "open_total": open_cursors.get("total", 0),
                "timed_out": cursor.get("timedOut", 0),
            }

        ttl = metrics.get("ttl")
        if ttl:
            result.ttl_metrics = {
                "deletedDocuments": ttl.get("deletedDocuments", 0),
                "passes": ttl.get("passes", 0),
            }

        query_metrics = metrics.get("query")
        if query_metrics:
            pc = query_metrics.get("planCache", {})
            if pc:
                result.plan_cache = {
                    "hits": pc.get("hits", 0),
                    "misses": pc.get("misses", 0),
                }
            sort = query_metrics.get("sort", {})
            if sort:
                result.sort_metrics = {
                    "spillToDisk": sort.get("spillToDisk", 0),
                    "totalBytesSorted": sort.get("totalBytesSorted", 0),
                }

    # Asserts
    result.asserts = data.get("asserts")


def _parse_db_stats(data: Dict[str, Any], result: MongoAnalysisResult) -> None:
    """Extract metrics from db.stats()."""
    result.storage = {
        "dataSize": data.get("dataSize", 0),
        "storageSize": data.get("storageSize", 0),
        "indexSize": data.get("indexSize", 0),
        "objects": data.get("objects", 0),
        "collections": data.get("collections", 0),
    }


def _parse_current_op(data: Any, result: MongoAnalysisResult) -> None:
    """Extract active operations from currentOp."""
    if not data:
        return
    inprog = data.get("inprog", []) if isinstance(data, dict) else []
    ops = []
    for op in inprog:
        ops.append({
            "opid": op.get("opid"),
            "type": op.get("type", op.get("op", "")),
            "ns": op.get("ns", ""),
            "microsecs_running": op.get("microsecs_running", 0),
            "desc": op.get("desc", ""),
        })
    result.active_ops = ops


def _parse_collection_stats(data: Any, result: MongoAnalysisResult) -> None:
    """Parse per-collection stats."""
    if not isinstance(data, list):
        return
    result.collection_stats = data


def _parse_slow_queries(data: Any, result: MongoAnalysisResult) -> None:
    """Parse slow queries from profiler."""
    if not isinstance(data, list):
        return
    result.slow_queries = data


def _parse_repl_info(data: Any, result: MongoAnalysisResult) -> None:
    """Parse oplog replication info."""
    if not data or not isinstance(data, dict):
        return
    result.oplog = {
        "logSizeMB": data.get("logSizeMB", 0),
        "usedMB": data.get("usedMB", 0),
        "timeDiffHours": data.get("timeDiffHours", 0),
    }


def _parse_top(data: Any, result: MongoAnalysisResult) -> None:
    """Parse top collection activity."""
    if not isinstance(data, list):
        return
    result.top_collections = data


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def _fmt_bytes(b: int) -> str:
    """Format bytes as human-readable."""
    if b >= 1024 * 1024 * 1024:
        return f"{b / 1024 / 1024 / 1024:.1f} GB"
    elif b >= 1024 * 1024:
        return f"{b / 1024 / 1024:.1f} MB"
    elif b >= 1024:
        return f"{b / 1024:.1f} KB"
    return f"{b} B"


def _fmt_count(n: int) -> str:
    """Format large numbers with K/M suffix."""
    if n >= 1_000_000_000:
        return f"{n / 1_000_000_000:.1f}B"
    elif n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    elif n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return str(n)


def _fmt_uptime(seconds: int) -> str:
    """Format seconds as Xd Yh."""
    days = seconds // 86400
    hours = (seconds % 86400) // 3600
    if days > 0:
        return f"{days}d {hours}h"
    elif hours > 0:
        return f"{hours}h {(seconds % 3600) // 60}m"
    return f"{seconds // 60}m"


def _fmt_us(microseconds: float) -> str:
    """Format microseconds as human-readable latency."""
    if microseconds >= 1_000_000:
        return f"{microseconds / 1_000_000:.1f}s"
    elif microseconds >= 1_000:
        return f"{microseconds / 1_000:.1f}ms"
    return f"{microseconds:.0f}us"


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def analyze_mongo(service: str, timeout: int = 300, quiet: bool = False,
                  skip_logs: bool = False, metrics_hours: int = 168,
                  project_id: Optional[str] = None,
                  environment_id: Optional[str] = None,
                  service_id: Optional[str] = None) -> MongoAnalysisResult:
    """Run complete MongoDB analysis."""
    if not quiet:
        print(f"Analyzing MongoDB database: {service}", file=sys.stderr)

    result = MongoAnalysisResult(
        service=service,
        db_type="mongo",
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

    # === PARALLEL DATA COLLECTION ===
    progress(3, 5, "Running analysis (metrics, mongo queries, logs in parallel)...", quiet)

    def task_metrics():
        if environment_id and service_id:
            return get_all_metrics_from_api(environment_id, service_id, hours=metrics_hours)
        return None

    def task_mongo_batch1():
        """serverStatus + dbStats + collectionStats."""
        if not ssh_available:
            return ("error", f"SSH not available: {ssh_stderr or 'connection failed'}")
        results = {}
        # serverStatus
        code, stdout, stderr = run_mongosh_query(service, QUERY_SERVER_STATUS, timeout=30)
        if code == 0:
            results["serverStatus"] = _safe_json(stdout)
        else:
            results["serverStatus_error"] = stderr or stdout or "unknown"
        # dbStats
        code, stdout, stderr = run_mongosh_query(service, QUERY_DB_STATS, timeout=30)
        if code == 0:
            results["dbStats"] = _safe_json(stdout)
        else:
            results["dbStats_error"] = stderr or stdout or "unknown"
        # collectionStats
        code, stdout, stderr = run_mongosh_query(service, QUERY_COLLECTION_STATS, timeout=30)
        if code == 0:
            results["collStats"] = _safe_json(stdout)
        else:
            results["collStats_error"] = stderr or stdout or "unknown"
        return ("ok", results)

    def task_mongo_batch2():
        """slowQueries + currentOp + replInfo + top."""
        if not ssh_available:
            return ("error", f"SSH not available: {ssh_stderr or 'connection failed'}")
        results = {}
        # slow queries
        code, stdout, stderr = run_mongosh_query(service, QUERY_SLOW_QUERIES, timeout=30)
        if code == 0:
            results["slowQueries"] = _safe_json(stdout)
        else:
            results["slowQueries_error"] = stderr or stdout or "unknown"
        # currentOp
        code, stdout, stderr = run_mongosh_query(service, QUERY_CURRENT_OP, timeout=30)
        if code == 0:
            results["currentOp"] = _safe_json(stdout)
        else:
            results["currentOp_error"] = stderr or stdout or "unknown"
        # replication info
        code, stdout, stderr = run_mongosh_query(service, QUERY_REPL_INFO, timeout=30)
        if code == 0:
            results["replInfo"] = _safe_json(stdout)
        else:
            results["replInfo_error"] = stderr or stdout or "unknown"
        # top
        code, stdout, stderr = run_mongosh_query(service, QUERY_TOP, timeout=30)
        if code == 0:
            results["top"] = _safe_json(stdout)
        else:
            results["top_error"] = stderr or stdout or "unknown"
        return ("ok", results)

    def task_logs():
        if skip_logs:
            return []
        return get_recent_logs(service, lines=LOG_LINES_DEFAULT,
                               environment_id=environment_id,
                               service_id=service_id)

    with ThreadPoolExecutor(max_workers=4) as executor:
        future_metrics = executor.submit(task_metrics)
        future_batch1 = executor.submit(task_mongo_batch1)
        future_batch2 = executor.submit(task_mongo_batch2)
        future_logs = executor.submit(task_logs)

        metrics_result = future_metrics.result()
        batch1_result = future_batch1.result()
        batch2_result = future_batch2.result()
        logs_result = future_logs.result()

    # === PROCESS METRICS ===
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

    # === PROCESS BATCH 1 (serverStatus, dbStats, collStats) ===
    if batch1_result[0] == "ok":
        b1 = batch1_result[1]
        ss = b1.get("serverStatus")
        if ss:
            _parse_server_status(ss, result)
            result.collection_status["server_status"] = {"status": "success"}
        else:
            err = b1.get("serverStatus_error", "no data")
            result.errors.append(f"serverStatus failed: {err}")
            result.collection_status["server_status"] = {"status": "error", "error": err}

        dbs = b1.get("dbStats")
        if dbs:
            _parse_db_stats(dbs, result)
            result.collection_status["db_stats"] = {"status": "success"}
        else:
            err = b1.get("dbStats_error", "no data")
            result.collection_status["db_stats"] = {"status": "error", "error": err}

        cs = b1.get("collStats")
        if cs:
            _parse_collection_stats(cs, result)
            result.collection_status["collection_stats"] = {"status": "success"}
        else:
            err = b1.get("collStats_error", "no data")
            result.collection_status["collection_stats"] = {"status": "error", "error": err}
    else:
        error_msg = batch1_result[1] if len(batch1_result) > 1 else "unknown"
        result.errors.append(f"Batch 1 (serverStatus/dbStats/collStats) failed: {error_msg}")
        for src in ("server_status", "db_stats", "collection_stats"):
            result.collection_status[src] = {"status": "error", "error": error_msg}

    # === PROCESS BATCH 2 (slowQueries, currentOp, replInfo, top) ===
    if batch2_result[0] == "ok":
        b2 = batch2_result[1]

        sq = b2.get("slowQueries")
        if sq is not None:
            _parse_slow_queries(sq, result)
            result.collection_status["slow_queries"] = {"status": "success"}
        else:
            err = b2.get("slowQueries_error", "no data")
            result.collection_status["slow_queries"] = {"status": "error", "error": err}

        co = b2.get("currentOp")
        if co is not None:
            _parse_current_op(co, result)
            result.collection_status["current_op"] = {"status": "success"}
        else:
            err = b2.get("currentOp_error", "no data")
            result.collection_status["current_op"] = {"status": "error", "error": err}

        ri = b2.get("replInfo")
        if ri is not None:
            _parse_repl_info(ri, result)
            result.collection_status["repl_info"] = {"status": "success"}
        else:
            err = b2.get("replInfo_error", "no data or not a replica set")
            result.collection_status["repl_info"] = {"status": "skipped", "reason": err}

        top = b2.get("top")
        if top is not None:
            _parse_top(top, result)
            result.collection_status["top"] = {"status": "success"}
        else:
            err = b2.get("top_error", "no data or insufficient privileges")
            result.collection_status["top"] = {"status": "skipped", "reason": err}
    else:
        error_msg = batch2_result[1] if len(batch2_result) > 1 else "unknown"
        result.errors.append(f"Batch 2 (slowQueries/currentOp/replInfo/top) failed: {error_msg}")
        for src in ("slow_queries", "current_op", "repl_info", "top"):
            result.collection_status[src] = {"status": "error", "error": error_msg}

    # === PROCESS LOGS ===
    progress(4, 5, "Processing logs...", quiet)
    if skip_logs:
        result.collection_status["logs_api"] = {"status": "skipped", "reason": "skip_logs flag set"}
    elif logs_result:
        result.recent_logs = logs_result
        result.collection_status["logs_api"] = {"status": "success", "lines": len(logs_result)}
        result.recent_errors = [
            line for line in result.recent_logs
            if 'ERROR' in line.upper() or 'FATAL' in line.upper() or 'PANIC' in line.upper()
        ][:100]
    else:
        result.recent_logs = []
        result.collection_status["logs_api"] = {"status": "error", "error": "Logs API returned no data"}

    # === RECOMMENDATIONS ===
    progress(5, 5, "Generating recommendations...", quiet)
    result.recommendations = generate_recommendations(result)

    if not quiet:
        total = dal._progress_timer.total_elapsed()
        print(f"Done.{total}", file=sys.stderr)

    return result


# ---------------------------------------------------------------------------
# Recommendations engine
# ---------------------------------------------------------------------------

def generate_recommendations(result: MongoAnalysisResult) -> List[Dict[str, str]]:
    """Generate recommendations based on analysis results."""
    recs: List[Dict[str, str]] = []

    # Collection failures — surface critical issues when SSH/introspection failed
    if result.collection_status:
        failed = {k: v for k, v in result.collection_status.items()
                  if v.get("status") in ("failed", "error")}
        ssh_sources = {"server_status", "db_stats", "collection_stats",
                       "slow_queries", "current_op", "repl_info", "top"}
        ssh_failed = {k: v for k, v in failed.items() if k in ssh_sources}
        if ssh_failed:
            sources = ", ".join(ssh_failed.keys())
            errors = "; ".join(v.get("error", "unknown") for v in ssh_failed.values())
            recs.append({
                "severity": "critical",
                "category": "collection",
                "message": f"SSH introspection failed — unable to collect {sources}. "
                           f"Error: {errors}. "
                           f"Analysis is incomplete: WiredTiger cache, connections, "
                           f"collection stats, and replication health could not be evaluated.",
            })

    # --- WiredTiger cache usage ---
    wt = result.wiredtiger_cache
    if wt:
        max_bytes = wt.get("max_bytes", 0)
        used_bytes = wt.get("bytes_in_cache", 0)
        dirty_bytes = wt.get("dirty_bytes", 0)
        app_evictions = wt.get("app_evictions", 0)

        if max_bytes > 0:
            usage_pct = round(100.0 * used_bytes / max_bytes, 1)
            if usage_pct > 80:
                recs.append({
                    "priority": "immediate",
                    "issue": f"WiredTiger cache is {usage_pct}% full ({_fmt_bytes(used_bytes)} of {_fmt_bytes(max_bytes)})",
                    "action": "Consider increasing service RAM. WiredTiger cache defaults to 50% of RAM minus 1 GB.",
                    "explanation": "When the WiredTiger cache is nearly full, MongoDB must evict pages more aggressively, "
                                   "increasing latency for reads and writes. Increasing RAM gives WiredTiger more room to cache data.",
                })

            if used_bytes > 0:
                dirty_pct = round(100.0 * dirty_bytes / max_bytes, 1)
                if dirty_pct > 20:
                    recs.append({
                        "priority": "short-term",
                        "issue": f"High dirty cache ({dirty_pct}% of total cache). Checkpoint may be falling behind.",
                        "action": "Monitor checkpoint duration and consider increasing RAM or reducing write throughput.",
                        "explanation": "Dirty pages must be written to disk during checkpoints. A high dirty ratio means "
                                       "checkpoints have more work, potentially causing latency spikes.",
                    })

        if app_evictions and app_evictions > 0:
            recs.append({
                "priority": "immediate",
                "issue": f"Application threads performing evictions ({app_evictions:,} pages). WiredTiger cache under pressure.",
                "action": "Increase RAM to give WiredTiger more cache space.",
                "explanation": "Normally the WiredTiger eviction threads handle cache pressure. When application threads "
                               "must evict pages themselves, queries stall waiting for cache space. This directly increases latency.",
            })

    # --- Connection usage ---
    conn = result.connections
    if conn:
        current = conn.get("current", 0)
        available = conn.get("available", 0)
        total = current + available
        if total > 0:
            pct = round(100.0 * current / total, 1)
            if pct > 80:
                recs.append({
                    "priority": "immediate" if pct > 90 else "short-term",
                    "issue": f"Connection usage at {pct}% ({current} of {total}). Approaching connection limit.",
                    "action": "Review application connection pooling. Consider using a connection pooler or increasing maxIncomingConnections.",
                    "explanation": "Running out of connections will cause new client connections to be refused. "
                                   "Most applications should use connection pooling to limit concurrent connections.",
                })

    # --- Page faults ---
    if result.page_faults and result.page_faults > 10000:
        recs.append({
            "priority": "short-term",
            "issue": f"Significant page faults ({result.page_faults:,}). Working set may exceed available RAM.",
            "action": "Increase service RAM or optimize queries to reduce working set size.",
            "explanation": "Page faults occur when MongoDB accesses data not in memory, requiring disk reads. "
                           "High page faults indicate the working set is larger than available RAM.",
        })

    # --- Queued operations ---
    gl = result.global_lock
    if gl:
        qr = gl.get("queue_readers", 0)
        qw = gl.get("queue_writers", 0)
        if qr > 0 or qw > 0:
            recs.append({
                "priority": "immediate" if (qr + qw) > 10 else "short-term",
                "issue": f"Operations queuing detected (readers: {qr}, writers: {qw}). Database may be under resource pressure.",
                "action": "Investigate slow operations and consider increasing RAM or CPU.",
                "explanation": "Queued operations mean requests are waiting for a lock. This can be caused by slow queries, "
                               "write-heavy workloads, or insufficient resources.",
            })

    # --- Query efficiency ---
    qe = result.query_executor
    dm = result.document_metrics
    if qe and dm:
        scanned = qe.get("scannedObjects", 0)
        returned = dm.get("returned", 0)
        if returned > 0 and scanned > returned * 10:
            ratio = round(scanned / returned, 1)
            recs.append({
                "priority": "immediate" if ratio > 100 else "short-term",
                "issue": f"Query efficiency concern: {_fmt_count(scanned)} objects scanned vs {_fmt_count(returned)} returned (ratio: {ratio}x).",
                "action": "Create indexes for frequently queried fields. Review slow query log for full collection scans.",
                "explanation": "A high scan-to-return ratio means MongoDB is examining many documents to satisfy queries. "
                               "Adding appropriate indexes dramatically reduces the number of documents examined.",
            })

    # --- Plan cache ---
    pc = result.plan_cache
    if pc:
        hits = pc.get("hits", 0)
        misses = pc.get("misses", 0)
        total = hits + misses
        if total > 100 and misses > hits:
            recs.append({
                "priority": "short-term",
                "issue": f"High plan cache miss ratio ({misses:,} misses vs {hits:,} hits). Queries may not be using optimal plans.",
                "action": "Consider creating indexes for frequent query patterns to stabilize query plans.",
                "explanation": "Plan cache misses mean MongoDB must re-evaluate query plans. Stable indexes help the planner "
                               "pick consistent, efficient plans.",
            })

    # --- Sort spill to disk ---
    sm = result.sort_metrics
    if sm:
        spill = sm.get("spillToDisk", 0)
        if spill > 0:
            recs.append({
                "priority": "short-term",
                "issue": f"Sorts spilling to disk ({spill:,} times). Queries performing in-memory sorts exceeding limit.",
                "action": "Add indexes to support sort operations, or increase RAM.",
                "explanation": "When a sort operation exceeds the memory limit (100 MB by default), MongoDB spills to disk. "
                               "Creating an index that matches the sort key avoids the in-memory sort entirely.",
            })

    # --- Cursor timeouts ---
    cur = result.cursors
    if cur:
        timed_out = cur.get("timed_out", 0)
        if timed_out > 0:
            recs.append({
                "priority": "short-term",
                "issue": f"Cursor timeouts detected ({timed_out:,}). Long-running queries may need optimization.",
                "action": "Review application code for unbounded queries or missing pagination.",
                "explanation": "Cursors time out after 10 minutes of inactivity by default. Frequent timeouts suggest "
                               "clients are not consuming results quickly enough or queries are returning too much data.",
            })

    # --- Asserts ---
    asserts = result.asserts
    if asserts:
        regular = asserts.get("regular", 0)
        warning = asserts.get("warning", 0)
        user = asserts.get("user", 0)
        msg = asserts.get("msg", 0)
        if regular > 0 or warning > 0 or user > 0:
            recs.append({
                "priority": "short-term",
                "issue": f"Database asserts detected (regular: {regular}, warning: {warning}, user: {user}, msg: {msg}). Investigate error conditions.",
                "action": "Check MongoDB logs for assert details. User asserts often indicate client errors; regular/warning asserts may signal server issues.",
                "explanation": "Asserts are internal consistency checks. Regular and warning asserts may indicate bugs or data issues. "
                               "User asserts are typically client-side errors (e.g., duplicate key violations).",
            })

    # --- Oplog usage ---
    oplog = result.oplog
    if oplog:
        log_size = oplog.get("logSizeMB", 0)
        used = oplog.get("usedMB", 0)
        if log_size > 0:
            oplog_pct = round(100.0 * used / log_size, 1)
            if oplog_pct > 80:
                recs.append({
                    "priority": "short-term",
                    "issue": f"Oplog is {oplog_pct}% full ({used:.0f} MB of {log_size:.0f} MB). May impact replication if oplog window is too small.",
                    "action": "Consider increasing the oplog size to maintain a larger replication window.",
                    "explanation": "The oplog stores recent write operations for replication. If it fills up and wraps around too quickly, "
                                   "replica set members that fall behind may need a full resync instead of incremental replication.",
                })

    return recs


# ---------------------------------------------------------------------------
# Report formatting
# ---------------------------------------------------------------------------

def format_report(result: MongoAnalysisResult) -> str:
    """Format analysis result as human-readable markdown report."""
    lines: List[str] = []
    lines.append("=" * 60)
    lines.append(f"# MongoDB Analysis: {result.service}")
    lines.append("=" * 60)
    lines.append(f"Timestamp: {result.timestamp}")
    lines.append(f"Status: {result.deployment_status}")
    lines.append("")

    # --- Data Collection Status ---
    if result.collection_status:
        lines.append("## Data Collection Status")
        lines.append("")
        lines.append("| Source | Status | Details |")
        lines.append("|--------|--------|---------|")
        source_labels = {
            "server_status": "Server Status (SSH)",
            "db_stats": "Database Stats (SSH)",
            "collection_stats": "Collection Stats (SSH)",
            "slow_queries": "Slow Queries (SSH)",
            "current_op": "Current Operations (SSH)",
            "repl_info": "Replication Info (SSH)",
            "top": "Top Collections (SSH)",
            "metrics_api": "Metrics API",
            "logs_api": "Logs API",
        }
        for source in ["server_status", "db_stats", "collection_stats",
                        "slow_queries", "current_op", "repl_info", "top",
                        "metrics_api", "logs_api"]:
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

    # --- Overview ---
    lines.append("## Overview")
    lines.append("")
    lines.append("| Metric | Value |")
    lines.append("|--------|-------|")
    if result.version:
        lines.append(f"| Version | {result.version} |")
    if result.storage_engine:
        lines.append(f"| Storage Engine | {result.storage_engine} |")
    if result.uptime_seconds is not None:
        lines.append(f"| Uptime | {_fmt_uptime(result.uptime_seconds)} |")
    status_icon = "Healthy" if result.deployment_status == "SUCCESS" else "Warning"
    lines.append(f"| Deployment | {result.deployment_status} | {status_icon} |")
    lines.append("")

    # --- Connections ---
    if result.connections:
        lines.append("## Connections")
        lines.append("")
        lines.append("| Metric | Value | Status |")
        lines.append("|--------|-------|--------|")
        c = result.connections
        current = c.get("current", 0)
        available = c.get("available", 0)
        total = current + available
        pct = round(100.0 * current / total, 1) if total > 0 else 0
        status = "Critical" if pct > 90 else "Warning" if pct > 80 else ""
        lines.append(f"| Current | {current:,} | {status} |")
        lines.append(f"| Available | {available:,} | |")
        lines.append(f"| Total Created | {c.get('totalCreated', 0):,} | |")
        lines.append("")

    # --- Operations (since startup) ---
    if result.opcounters:
        lines.append("## Operations (since startup)")
        lines.append("")
        lines.append("| Operation | Count |")
        lines.append("|-----------|-------|")
        for op in ("insert", "query", "update", "delete", "getmore", "command"):
            val = result.opcounters.get(op, 0)
            lines.append(f"| {op} | {_fmt_count(val)} |")
        lines.append("")

    # --- Replication opcounters ---
    if result.opcounters_repl:
        any_repl = any(v > 0 for v in result.opcounters_repl.values() if isinstance(v, (int, float)))
        if any_repl:
            lines.append("## Replication Operations")
            lines.append("")
            lines.append("| Operation | Count |")
            lines.append("|-----------|-------|")
            for op in ("insert", "query", "update", "delete", "getmore", "command"):
                val = result.opcounters_repl.get(op, 0)
                lines.append(f"| {op} | {_fmt_count(val)} |")
            lines.append("")

    # --- Latency ---
    if result.op_latencies:
        lines.append("## Latency")
        lines.append("")
        lines.append("| Operation | Avg Latency | Total Ops |")
        lines.append("|-----------|-------------|-----------|")
        for key, label in [("reads", "Reads"), ("writes", "Writes"), ("commands", "Commands")]:
            entry = result.op_latencies.get(key, {})
            avg_us = entry.get("avg_us", 0)
            ops = entry.get("ops", 0)
            lines.append(f"| {label} | {_fmt_us(avg_us)} | {_fmt_count(ops)} |")
        lines.append("")

    # --- Memory ---
    if result.memory:
        lines.append("## Memory")
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        lines.append(f"| Resident | {result.memory.get('resident_mb', 0):,} MB |")
        lines.append(f"| Virtual | {result.memory.get('virtual_mb', 0):,} MB |")
        if result.page_faults is not None:
            lines.append(f"| Page Faults | {result.page_faults:,} |")
        lines.append("")

    # --- WiredTiger Cache ---
    wt = result.wiredtiger_cache
    if wt:
        lines.append("## WiredTiger Cache")
        lines.append("")
        lines.append("| Metric | Value | Status |")
        lines.append("|--------|-------|--------|")
        used = wt.get("bytes_in_cache", 0)
        max_b = wt.get("max_bytes", 0)
        dirty = wt.get("dirty_bytes", 0)
        app_evict = wt.get("app_evictions", 0)
        lines.append(f"| Used | {_fmt_bytes(used)} | |")
        lines.append(f"| Maximum | {_fmt_bytes(max_b)} | |")
        if max_b > 0:
            usage_pct = round(100.0 * used / max_b, 1)
            cache_status = "Critical" if usage_pct > 90 else "Warning" if usage_pct > 80 else "OK"
            lines.append(f"| Usage | {usage_pct}% | {cache_status} |")
        lines.append(f"| Dirty | {_fmt_bytes(dirty)} | |")
        evict_status = "Warning" if app_evict > 0 else "OK"
        lines.append(f"| App Thread Evictions | {app_evict:,} | {evict_status} |")
        lines.append(f"| Pages Read Into Cache | {wt.get('pages_read', 0):,} | |")
        lines.append(f"| Pages Written From Cache | {wt.get('pages_written', 0):,} | |")
        lines.append("")

    # --- WiredTiger Checkpoint ---
    cp = result.wiredtiger_checkpoint
    if cp:
        ms = cp.get("most_recent_time_ms", 0)
        lines.append("## WiredTiger Checkpoint")
        lines.append("")
        lines.append(f"| Most Recent Checkpoint Time | {ms:,} ms |")
        lines.append("")

    # --- WiredTiger Tickets ---
    tk = result.wiredtiger_tickets
    if tk:
        lines.append("## WiredTiger Tickets")
        lines.append("")
        lines.append("| Metric | Available | Total |")
        lines.append("|--------|-----------|-------|")
        lines.append(f"| Read | {tk.get('read_available', 0)} | {tk.get('read_total', 0)} |")
        lines.append(f"| Write | {tk.get('write_available', 0)} | {tk.get('write_total', 0)} |")
        lines.append("")

    # --- Global Lock ---
    gl = result.global_lock
    if gl:
        lines.append("## Global Lock")
        lines.append("")
        lines.append("| Metric | Readers | Writers |")
        lines.append("|--------|---------|---------|")
        lines.append(f"| Queue | {gl.get('queue_readers', 0)} | {gl.get('queue_writers', 0)} |")
        lines.append(f"| Active | {gl.get('active_readers', 0)} | {gl.get('active_writers', 0)} |")
        lines.append("")

    # --- Network ---
    if result.network:
        lines.append("## Network")
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        lines.append(f"| Bytes In | {_fmt_bytes(result.network.get('bytesIn', 0))} |")
        lines.append(f"| Bytes Out | {_fmt_bytes(result.network.get('bytesOut', 0))} |")
        lines.append(f"| Requests | {_fmt_count(result.network.get('numRequests', 0))} |")
        lines.append("")

    # --- Document Metrics ---
    dm = result.document_metrics
    if dm:
        lines.append("## Documents")
        lines.append("")
        lines.append("| Operation | Count |")
        lines.append("|-----------|-------|")
        for key in ("inserted", "updated", "deleted", "returned"):
            lines.append(f"| {key} | {_fmt_count(dm.get(key, 0))} |")
        lines.append("")

    # --- Query Efficiency ---
    qe = result.query_executor
    if qe:
        lines.append("## Query Efficiency")
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        lines.append(f"| Scanned Objects | {_fmt_count(qe.get('scannedObjects', 0))} |")
        lines.append(f"| Scanned Keys | {_fmt_count(qe.get('scanned', 0))} |")
        if dm:
            returned = dm.get("returned", 0)
            scanned = qe.get("scannedObjects", 0)
            if returned > 0:
                ratio = round(scanned / returned, 1)
                status = "Warning" if ratio > 10 else "OK"
                lines.append(f"| Scan-to-Return Ratio | {ratio}x | {status} |")
        lines.append("")

    # --- Plan Cache ---
    pc = result.plan_cache
    if pc:
        lines.append("## Plan Cache (7.0+)")
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        lines.append(f"| Hits | {_fmt_count(pc.get('hits', 0))} |")
        lines.append(f"| Misses | {_fmt_count(pc.get('misses', 0))} |")
        lines.append("")

    # --- Sort Metrics ---
    sm = result.sort_metrics
    if sm:
        lines.append("## Sort (7.0+)")
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        lines.append(f"| Spill to Disk | {sm.get('spillToDisk', 0):,} |")
        lines.append(f"| Total Bytes Sorted | {_fmt_bytes(sm.get('totalBytesSorted', 0))} |")
        lines.append("")

    # --- Cursors ---
    cur = result.cursors
    if cur:
        lines.append("## Cursors")
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        lines.append(f"| Open Total | {cur.get('open_total', 0):,} |")
        timed = cur.get("timed_out", 0)
        status = "Warning" if timed > 0 else ""
        lines.append(f"| Timed Out | {timed:,} | {status} |")
        lines.append("")

    # --- TTL ---
    ttl = result.ttl_metrics
    if ttl:
        lines.append("## TTL")
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        lines.append(f"| Deleted Documents | {_fmt_count(ttl.get('deletedDocuments', 0))} |")
        lines.append(f"| Passes | {ttl.get('passes', 0):,} |")
        lines.append("")

    # --- Asserts ---
    asserts = result.asserts
    if asserts:
        any_assert = any(asserts.get(k, 0) > 0 for k in ("regular", "warning", "msg", "user"))
        if any_assert:
            lines.append("## Asserts")
            lines.append("")
            lines.append("| Type | Count |")
            lines.append("|------|-------|")
            for key in ("regular", "warning", "msg", "user", "rollovers"):
                lines.append(f"| {key} | {asserts.get(key, 0):,} |")
            lines.append("")

    # --- Storage ---
    st = result.storage
    if st:
        lines.append("## Storage")
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        lines.append(f"| Data Size | {_fmt_bytes(st.get('dataSize', 0))} |")
        lines.append(f"| Storage Size | {_fmt_bytes(st.get('storageSize', 0))} |")
        lines.append(f"| Index Size | {_fmt_bytes(st.get('indexSize', 0))} |")
        lines.append(f"| Objects | {_fmt_count(st.get('objects', 0))} |")
        lines.append(f"| Collections | {st.get('collections', 0)} |")
        lines.append("")

    # --- Collections ---
    if result.collection_stats:
        lines.append("## Collections")
        lines.append("")
        lines.append("| Collection | Documents | Data Size | Storage | Indexes |")
        lines.append("|------------|-----------|-----------|---------|---------|")
        # Sort by size descending
        sorted_colls = sorted(result.collection_stats, key=lambda c: c.get("size", 0), reverse=True)
        for c in sorted_colls:
            name = c.get("name", "?")
            count = _fmt_count(c.get("count", 0))
            size = _fmt_bytes(c.get("size", 0))
            storage = _fmt_bytes(c.get("storageSize", 0))
            nidx = c.get("nindexes", 0)
            lines.append(f"| {name} | {count} | {size} | {storage} | {nidx} |")
        lines.append("")

    # --- Top Collections by Activity ---
    if result.top_collections:
        lines.append("## Top Collections by Activity")
        lines.append("")
        lines.append("| Namespace | Reads | Read Time | Writes | Write Time |")
        lines.append("|-----------|-------|-----------|--------|------------|")
        # Sort by total activity
        sorted_top = sorted(result.top_collections,
                            key=lambda t: t.get("reads", 0) + t.get("writes", 0),
                            reverse=True)
        for t in sorted_top[:20]:
            ns = t.get("ns", "?")
            reads = _fmt_count(t.get("reads", 0))
            read_time = _fmt_us(t.get("readTimeUs", 0))
            writes = _fmt_count(t.get("writes", 0))
            write_time = _fmt_us(t.get("writeTimeUs", 0))
            lines.append(f"| {ns} | {reads} | {read_time} | {writes} | {write_time} |")
        lines.append("")

    # --- Replication ---
    if result.replication:
        lines.append("## Replication")
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        r = result.replication
        if r.get("setName"):
            lines.append(f"| Replica Set | {r['setName']} |")
        lines.append(f"| Is Writable Primary | {r.get('isWritablePrimary', 'N/A')} |")
        if r.get("primary"):
            lines.append(f"| Primary | {r['primary']} |")
        if r.get("hosts"):
            lines.append(f"| Hosts | {', '.join(r['hosts'])} |")
        lines.append("")

    # --- Oplog ---
    if result.oplog:
        lines.append("## Oplog")
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        ol = result.oplog
        log_size = ol.get("logSizeMB", 0)
        used = ol.get("usedMB", 0)
        lines.append(f"| Log Size | {log_size:.0f} MB |")
        lines.append(f"| Used | {used:.0f} MB |")
        if log_size > 0:
            lines.append(f"| Usage | {round(100.0 * used / log_size, 1)}% |")
        hours = ol.get("timeDiffHours", 0)
        lines.append(f"| Time Window | {hours:.1f} hours |")
        lines.append("")

    # --- Slow Queries ---
    if result.slow_queries:
        lines.append("## Slow Queries")
        lines.append("")
        lines.append("| Op | Namespace | Duration | Plan |")
        lines.append("|----|-----------|----------|------|")
        for q in result.slow_queries:
            op = q.get("op", "?")
            ns = q.get("ns", "?")
            millis = q.get("millis", 0)
            plan = q.get("planSummary", "")
            lines.append(f"| {op} | {ns} | {millis}ms | {plan} |")
        lines.append("")

    # --- Active Operations ---
    if result.active_ops:
        lines.append("## Active Operations")
        lines.append("")
        lines.append("| OpID | Type | Namespace | Duration |")
        lines.append("|------|------|-----------|----------|")
        sorted_ops = sorted(result.active_ops, key=lambda o: o.get("microsecs_running", 0), reverse=True)
        for op in sorted_ops[:20]:
            opid = op.get("opid", "?")
            op_type = op.get("type", "?")
            ns = op.get("ns", "")
            us = op.get("microsecs_running", 0)
            lines.append(f"| {opid} | {op_type} | {ns} | {_fmt_us(us)} |")
        lines.append("")

    # --- Infrastructure Trends ---
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
                        f"| {label} | {m['current']} {unit} | {m['min']} | {m['max']} | "
                        f"{m['avg']} | {arrow} {direction} | {change:+.1f}%{spike_note} |"
                    )
            lines.append("")

    # --- CPU / Memory summary ---
    if result.cpu_memory:
        lines.append("## Resource Usage")
        lines.append("")
        lines.append("| Metric | Value | Status |")
        lines.append("|--------|-------|--------|")
        cm = result.cpu_memory
        if "cpu_percent" in cm:
            cpu = cm["cpu_percent"]
            status = "Critical" if cpu > 85 else "Warning" if cpu > 70 else "Healthy"
            trend_str = _trend_indicator(result.metrics_history, "cpu")
            lines.append(f"| CPU Usage | {cpu} vCPU{trend_str} | {status} |")
            if cm.get("cpu_limit"):
                lines.append(f"| CPU Limit | {cm['cpu_limit']} vCPU | - |")
        if "memory_gb" in cm:
            mem_val = cm["memory_gb"]
            trend_str = _trend_indicator(result.metrics_history, "memory")
            utilization = ""
            if cm.get("memory_limit_gb"):
                pct = round((mem_val / cm["memory_limit_gb"]) * 100, 1)
                status = "Critical" if pct > 90 else "Warning" if pct > 80 else "Healthy"
                utilization = f" ({pct}% of {cm['memory_limit_gb']} GB)"
            else:
                status = "-"
            lines.append(f"| Memory Usage | {mem_val} GB{utilization}{trend_str} | {status} |")
        if result.disk_usage:
            lines.append(f"| Disk Usage | {result.disk_usage.get('used', 'N/A')} | - |")
        lines.append("")

    # --- Recent Errors ---
    if result.recent_errors:
        lines.append("## Recent Errors")
        lines.append("")
        for error in result.recent_errors[:10]:
            lines.append(f"- {error[:150]}...")
        lines.append("")

    # --- Recommendations ---
    if result.recommendations:
        lines.append("## Recommendations")
        lines.append("")
        for i, rec in enumerate(result.recommendations, 1):
            priority = rec["priority"].upper()
            lines.append(f"{i}. **[{priority}]** {rec['issue']}")
            lines.append(f"   **Action:** {rec['action']}")
            if rec.get("explanation"):
                lines.append(f"   **Why:** {rec['explanation']}")
            lines.append("")

    # --- Errors ---
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

    elif args.step == "server-status":
        print(f"Running serverStatus on: {service}", file=sys.stderr)
        code, stdout, stderr = run_mongosh_query(service, QUERY_SERVER_STATUS, timeout=30)
        print(f"Exit code: {code}")
        if code == 0 and stdout:
            data = _safe_json(stdout)
            if data:
                print(json.dumps(data, indent=2))
            else:
                print(f"Raw output:\n{stdout}")
        else:
            print(f"Error: {stderr or stdout}")
        return code

    elif args.step == "db-stats":
        print(f"Running db.stats() on: {service}", file=sys.stderr)
        code, stdout, stderr = run_mongosh_query(service, QUERY_DB_STATS, timeout=30)
        print(f"Exit code: {code}")
        if code == 0 and stdout:
            data = _safe_json(stdout)
            if data:
                print(json.dumps(data, indent=2))
            else:
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


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="MongoDB analysis for Railway services.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument("--service", required=True, help="Service name")
    parser.add_argument("--json", action="store_true",
                        help="Output as JSON")
    parser.add_argument("--timeout", type=int, default=300,
                        help="Timeout in seconds (default: 300)")
    parser.add_argument("--quiet", "-q", action="store_true",
                        help="Suppress progress messages")
    parser.add_argument("--skip-logs", action="store_true",
                        help="Skip log fetching for faster analysis")
    parser.add_argument("--metrics-hours", type=int, default=168,
                        help="Hours of metrics history to fetch (default: 168, max: 168)")
    parser.add_argument("--step",
                        choices=["ssh-test", "server-status", "db-stats", "logs", "metrics"],
                        help="Run a single collection step for debugging")
    parser.add_argument("--project-id", help="Project ID (bypasses railway link)")
    parser.add_argument("--environment-id", help="Environment ID (bypasses railway link)")
    parser.add_argument("--service-id", help="Service ID (bypasses railway link)")

    args = parser.parse_args()

    if args.step:
        return run_single_step(args)

    result = analyze_mongo(
        args.service,
        timeout=args.timeout,
        quiet=args.quiet,
        skip_logs=args.skip_logs,
        metrics_hours=min(args.metrics_hours, 168),
        project_id=args.project_id,
        environment_id=args.environment_id,
        service_id=args.service_id,
    )

    if args.json:
        print(json.dumps(asdict(result), indent=2))
    else:
        print(format_report(result))

    return 0


if __name__ == "__main__":
    sys.exit(main())

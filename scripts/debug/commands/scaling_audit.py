"""Scaling audit command — replay orchestrator decisions and flag contradictions."""

import json
import re
from datetime import datetime, timezone, timedelta

from debug.client import DebugClient


def run(client: DebugClient, options: dict):
    """Handle 'debug.py scaling_audit' command."""
    try:
        hours = int(options.get('hours', 3))
        cutoff = _hours_ago(hours)

        # ── 1. Query orchestrator logs ────────────────────────────────────
        logs_result = client.supabase.table('system_logs').select(
            'id, timestamp, message, worker_id, metadata'
        ).eq(
            'source_type', 'orchestrator_gpu'
        ).gte(
            'timestamp', cutoff
        ).order(
            'timestamp', desc=False
        ).limit(5000).execute()

        logs = logs_result.data or []

        # ── 2. Extract events ─────────────────────────────────────────────
        spawns = {}       # worker_id -> spawn timestamp
        kills = {}        # worker_id -> {timestamp, reason}
        promotions = {}   # worker_id -> promotion timestamp
        total_promoted = 0
        total_failed_in_cycle = 0

        for log in logs:
            msg = log.get('message', '')
            ts = log.get('timestamp', '')
            wid = log.get('worker_id')
            meta = log.get('metadata') or {}

            # Worker spawns: "Creating worker: {worker_id}"
            spawn_match = re.search(r'Creating worker:\s*(\S+)', msg)
            if spawn_match:
                spawn_id = spawn_match.group(1)
                spawns[spawn_id] = ts

            # Worker kills: "WORKER_LIFECYCLE [Worker {id}] MARKING AS ERROR: {reason}"
            kill_match = re.search(r'\[Worker\s+(gpu-\S+)\]\s*MARKING AS ERROR:\s*(.+)', msg)
            if kill_match:
                kill_wid = kill_match.group(1)
                kills[kill_wid] = {
                    'timestamp': ts,
                    'reason': kill_match.group(2).strip(),
                }
            elif 'MARKING AS ERROR' in msg and wid:
                # Fallback: use worker_id field if set
                reason_match = re.search(r'MARKING AS ERROR:\s*(.+)', msg)
                kills[wid] = {
                    'timestamp': ts,
                    'reason': reason_match.group(1).strip() if reason_match else msg,
                }

            # Cycle summaries with promotion/failure counts
            if 'workers_promoted' in meta:
                count = meta.get('workers_promoted', 0)
                if isinstance(count, (int, float)) and count > 0:
                    total_promoted += int(count)

            if 'workers_failed' in meta:
                count = meta.get('workers_failed', 0)
                if isinstance(count, (int, float)) and count > 0:
                    total_failed_in_cycle += int(count)

            # Try to detect per-worker promotion from logs
            if wid and ('promoted' in msg.lower() or 'gpu_ready' in msg.lower()):
                if wid not in promotions:
                    promotions[wid] = ts

        # ── 3. Query completed/failed tasks in window ─────────────────────
        tasks_result = client.supabase.table('tasks').select(
            'id, worker_id, status, updated_at, created_at'
        ).in_(
            'status', ['Complete', 'Failed']
        ).gte(
            'created_at', cutoff
        ).limit(5000).execute()

        tasks = tasks_result.data or []

        # Build worker -> completed tasks mapping
        worker_tasks = {}  # worker_id -> list of {updated_at, status}
        for t in tasks:
            wid = t.get('worker_id')
            if not wid:
                continue
            if wid not in worker_tasks:
                worker_tasks[wid] = []
            worker_tasks[wid].append({
                'updated_at': t.get('updated_at') or t.get('created_at'),
                'status': t.get('status'),
            })

        # ── 3b. Supplement with workers table (catches workers missed by log parsing) ──
        workers_result = client.supabase.table('workers').select(
            'id, status, created_at, last_heartbeat, metadata'
        ).gte('created_at', cutoff).order('created_at').limit(100).execute()

        for w in (workers_result.data or []):
            wid = w['id']
            if wid not in spawns:
                spawns[wid] = w.get('created_at', '')
            if w.get('status') in ('error', 'terminated'):
                meta = w.get('metadata') or {}
                if wid not in kills:
                    # Use last_heartbeat as approximate kill time (closer to actual death than created_at)
                    kill_time = w.get('last_heartbeat') or w.get('created_at', '')
                    kills[wid] = {
                        'timestamp': kill_time,
                        'reason': meta.get('termination_reason', meta.get('error', f"status={w['status']}")),
                    }

        capacity_report = _build_capacity_reconciler_report(client, cutoff, logs)

        # ── 4. Analyze each worker ────────────────────────────────────────
        all_worker_ids = set(spawns.keys()) | set(kills.keys()) | set(promotions.keys()) | set(worker_tasks.keys())

        issues = []       # (severity, worker_id, details)
        healthy = []      # (worker_id, details)

        productive_kills = 0
        wasted_spawns = 0

        for wid in sorted(all_worker_ids):
            was_killed = wid in kills
            was_spawned = wid in spawns
            was_promoted = wid in promotions
            completed = [
                t for t in worker_tasks.get(wid, [])
                if t['status'] in ('Complete', 'Completed')
            ]
            task_count = len(completed)

            if was_killed:
                kill_info = kills[wid]
                kill_ts = _parse_ts(kill_info['timestamp'])
                reason = kill_info['reason']

                # Check if worker completed tasks within 10 min of kill
                recent_completions = []
                if kill_ts and completed:
                    for t in completed:
                        t_ts = _parse_ts(t['updated_at'])
                        if t_ts and kill_ts:
                            delta = (kill_ts - t_ts).total_seconds()
                            if 0 <= delta <= 600:  # within 10 min before kill
                                recent_completions.append((t_ts, delta))

                if recent_completions:
                    # PRODUCTIVE WORKER KILLED
                    recent_completions.sort(key=lambda x: x[1])
                    last_ts, last_delta = recent_completions[0]
                    productive_kills += 1
                    issues.append(('red', wid, {
                        'type': 'PRODUCTIVE WORKER KILLED',
                        'reason': reason,
                        'kill_time': _fmt_time(kill_ts),
                        'last_task_time': _fmt_time(last_ts),
                        'last_task_delta': _fmt_duration(last_delta),
                        'tasks_before_kill': task_count,
                    }))

                elif 'Spawning timeout' in reason or 'spawn' in reason.lower():
                    # Never initialized
                    wasted_spawns += 1
                    issues.append(('yellow', wid, {
                        'type': 'WORKER NEVER INITIALIZED',
                        'reason': reason,
                    }))

                elif '1800' in reason or 'startup' in reason.lower():
                    # Startup timeout
                    wasted_spawns += 1
                    issues.append(('yellow', wid, {
                        'type': 'STARTUP TIMEOUT',
                        'reason': reason,
                    }))

                elif task_count == 0 and not was_promoted:
                    # Killed before doing anything useful
                    wasted_spawns += 1
                    issues.append(('yellow', wid, {
                        'type': 'WORKER NEVER INITIALIZED',
                        'reason': reason,
                    }))

                else:
                    # Killed but not recently productive — healthy lifecycle
                    healthy.append((wid, {
                        'promoted_at': _fmt_time(_parse_ts(promotions.get(wid, ''))) if wid in promotions else None,
                        'tasks_completed': task_count,
                    }))
            else:
                # Still alive or unknown
                healthy.append((wid, {
                    'promoted_at': _fmt_time(_parse_ts(promotions.get(wid, ''))) if wid in promotions else None,
                    'tasks_completed': task_count,
                    'alive': True,
                }))

        still_alive = len([h for h in healthy if h[1].get('alive')])

        # ── 5. Print report ───────────────────────────────────────────────
        print("=" * 80)
        print(f"SCALING AUDIT (last {hours} hours)")
        print("=" * 80)

        print(f"""
  Summary:
    Workers spawned:    {len(spawns)}
    Workers promoted:   {total_promoted or len(promotions)}
    Workers killed:     {len(kills)}
    Workers still alive: {still_alive}
""")

        if issues:
            print("  " + "\u2500" * 3 + " Issues Found " + "\u2500" * 3)
            print()
            for severity, wid, details in issues:
                issue_type = details['type']
                if severity == 'red':
                    symbol = "\U0001f534"
                    print(f"  {symbol} {issue_type}")
                    print(f"     Worker: {wid}")
                    print(f"     Kill reason: {details['reason']}")
                    print(f"     Kill time: {details['kill_time']}")
                    print(f"     Last task completed: {details['last_task_time']} ({details['last_task_delta']} before kill)")
                    print(f"     Tasks completed before kill: {details['tasks_before_kill']}")
                    if details.get('last_task_delta'):
                        # Parse seconds from delta for advice
                        print(f"     \u2192 Worker was actively productive. Kill was premature.")
                elif severity == 'yellow':
                    symbol = "\U0001f7e1"
                    print(f"  {symbol} {issue_type}")
                    print(f"     Worker: {wid}")
                    print(f"     Kill reason: {details['reason']}")
                    print(f"     \u2192 Worker failed to start within timeout.")
                print()

        if healthy:
            print("  " + "\u2500" * 3 + " Healthy Workers " + "\u2500" * 3)
            print()
            for wid, details in healthy:
                alive_tag = " (still running)" if details.get('alive') else ""
                promoted = f"Promoted at {details['promoted_at']}, " if details.get('promoted_at') else ""
                task_count = details.get('tasks_completed', 0)
                print(f"  \u2705 {wid}{alive_tag}")
                print(f"     {promoted}completed {task_count} tasks, no issues")
            print()

        # Churn rate
        total_spawned = len(spawns) or 1
        normal_lifecycle = len(healthy)
        utilization = int((normal_lifecycle / total_spawned) * 100) if total_spawned else 0
        capacity_report['legacy_worker_mutation_counts'] = {
            'spawns': len(spawns),
            'kills': len(kills),
            'productive_kills': productive_kills,
            'wasted_spawns': wasted_spawns,
        }
        capacity_report['divergence_counts'] = {
            'shadow_intended_actions': sum(capacity_report.get('shadow_action_counts', {}).values()),
            'intent_actions': sum(capacity_report.get('intent_action_counts', {}).values()),
            'legacy_worker_mutations': len(spawns) + len(kills),
            'lease_suppressed': capacity_report.get('lease_suppressed_rows', 0),
            'route_demand_fallback': capacity_report.get('route_demand_fallback_rows', 0),
        }

        if options.get('format') == 'json':
            print(json.dumps({
                'hours': hours,
                'workers_spawned': len(spawns),
                'workers_promoted': total_promoted or len(promotions),
                'workers_killed': len(kills),
                'workers_still_alive': still_alive,
                'productive_kills': productive_kills,
                'wasted_spawns': wasted_spawns,
                'effective_utilization_percent': utilization,
                'issues': issues,
                'healthy': healthy,
                'capacity_reconciler': capacity_report,
            }, indent=2, default=str))
            return

        print("  " + "\u2500" * 3 + " Churn Rate " + "\u2500" * 3)
        print()
        print(f"  Workers spawned: {len(spawns)} | Productive kills: {productive_kills} | Wasted spawns: {wasted_spawns}")
        print(f"  Effective utilization: {utilization}% ({normal_lifecycle} of {len(spawns)} workers completed their lifecycle normally)")
        print()

        _print_capacity_reconciler_report(capacity_report)

    except Exception as e:
        print(f"Error running scaling audit: {e}")
        if options.get('debug'):
            import traceback
            traceback.print_exc()


def _hours_ago(hours: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def _parse_ts(ts_str: str) -> datetime | None:
    if not ts_str:
        return None
    try:
        return datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return None


def _fmt_time(dt: datetime | None) -> str | None:
    if not dt:
        return None
    return dt.strftime('%H:%M:%S')


def _fmt_duration(seconds: float) -> str:
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    minutes = seconds // 60
    secs = seconds % 60
    if secs:
        return f"{minutes}m {secs}s"
    return f"{minutes}m"


def _build_capacity_reconciler_report(client: DebugClient, cutoff: str, logs: list[dict]) -> dict:
    intents, intents_error = _fetch_table_rows(
        client,
        table='worker_capacity_intents',
        select=(
            'id, pool, route_key, desired_capacity, reason, observed_queued, '
            'observed_active, observed_spawning, observed_idle, observed_in_progress, '
            'effective_capacity, cycle_id, observer_id, observation_id, actions, '
            'suppressed_actions, outcome, created_at, valid_until, stable_since, shadow'
        ),
        cutoff_column='created_at',
        cutoff=cutoff,
        limit=1000,
        order_column='created_at',
    )
    backoffs, backoffs_error = _fetch_table_rows(
        client,
        table='worker_capacity_route_backoffs',
        select=(
            'pool, route_key, consecutive_spawn_failures, next_spawn_allowed_at, '
            'last_spawn_failed_at, last_spawn_succeeded_at, last_error, updated_at'
        ),
        cutoff_column=None,
        cutoff=cutoff,
        limit=1000,
        order_column='updated_at',
    )

    leases, leases_error = _fetch_table_rows(
        client,
        table='orchestrator_leases',
        select='lease_key, pool, holder_id, acquired_at, expires_at, metadata',
        cutoff_column=None,
        cutoff=cutoff,
        limit=100,
        order_column='expires_at',
    )

    shadow_logs = [
        log for log in logs
        if isinstance(log.get('metadata'), dict)
        and log.get('metadata', {}).get('shadow_intended_action')
    ]

    intents_by_pool: dict[str, list[dict]] = {}
    authoritative_cycle_counts: dict[tuple[str, str], int] = {}
    shadow_observations: dict[tuple[str, str], int] = {}
    action_counts: dict[str, int] = {}
    suppressed_counts: dict[str, int] = {}
    route_fallback_count = 0
    lease_suppressed_count = 0
    adoptions: list[dict] = []

    for row in intents:
        pool = row.get('pool') or 'unknown'
        intents_by_pool.setdefault(pool, []).append(row)
        for action in row.get('actions') or []:
            action_type = action.get('type', 'unknown')
            action_counts[action_type] = action_counts.get(action_type, 0) + 1
        for action in row.get('suppressed_actions') or []:
            action_type = action.get('type', 'unknown')
            suppressed_counts[action_type] = suppressed_counts.get(action_type, 0) + 1

        outcome = row.get('outcome') or {}
        if outcome.get('route_demand_fallback'):
            route_fallback_count += 1
        if outcome.get('lease_suppressed'):
            lease_suppressed_count += 1

        adopted = outcome.get('adopted_legacy_spawning_worker_ids') or []
        if adopted:
            adoptions.append({
                'created_at': row.get('created_at'),
                'pool': pool,
                'cycle_id': row.get('cycle_id'),
                'intent_id': row.get('id'),
                'worker_ids': adopted,
            })

        cycle_id = row.get('cycle_id')
        if row.get('shadow') is False and cycle_id is not None:
            key = (pool, str(cycle_id))
            authoritative_cycle_counts[key] = authoritative_cycle_counts.get(key, 0) + 1

        if row.get('shadow') is True:
            key = (str(row.get('observer_id')), str(row.get('observation_id')))
            shadow_observations[key] = shadow_observations.get(key, 0) + 1

    pool_stability = []
    for pool, rows in sorted(intents_by_pool.items()):
        ordered = sorted(rows, key=lambda row: row.get('created_at') or '')
        changes = 0
        previous = None
        for row in ordered:
            desired = row.get('desired_capacity')
            if previous is not None and desired != previous:
                changes += 1
            previous = desired
        latest = ordered[-1] if ordered else {}
        pool_stability.append({
            'pool': pool,
            'rows': len(rows),
            'latest_created_at': latest.get('created_at'),
            'latest_desired_capacity': latest.get('desired_capacity'),
            'latest_effective_capacity': latest.get('effective_capacity'),
            'latest_reason': latest.get('reason'),
            'latest_stable_since': latest.get('stable_since'),
            'desired_capacity_changes': changes,
        })

    active_backoffs = [
        row for row in backoffs
        if row.get('next_spawn_allowed_at') and row.get('consecutive_spawn_failures', 0)
    ]

    return {
        'errors': {
            'intents': intents_error,
            'route_backoffs': backoffs_error,
            'leases': leases_error,
        },
        'intent_rows': len(intents),
        'shadow_intent_rows': len([row for row in intents if row.get('shadow') is True]),
        'authoritative_intent_rows': len([row for row in intents if row.get('shadow') is False]),
        'shadow_intended_log_rows': len(shadow_logs),
        'shadow_action_counts': _count_shadow_log_actions(shadow_logs),
        'intent_action_counts': action_counts,
        'suppressed_action_counts': suppressed_counts,
        'pool_stability': pool_stability,
        'duplicate_shadow_observations': [
            {'observer_id': key[0], 'observation_id': key[1], 'rows': count}
            for key, count in shadow_observations.items()
            if count > 1
        ],
        'authoritative_cycle_duplicates': [
            {'pool': key[0], 'cycle_id': key[1], 'rows': count}
            for key, count in authoritative_cycle_counts.items()
            if count != 1
        ],
        'route_demand_fallback_rows': route_fallback_count,
        'lease_suppressed_rows': lease_suppressed_count,
        'latest_adoptions': adoptions[:10],
        'route_backoffs': active_backoffs[:20],
        'leases': leases[:20],
    }


def _fetch_table_rows(
    client: DebugClient,
    *,
    table: str,
    select: str,
    cutoff_column: str | None,
    cutoff: str,
    limit: int,
    order_column: str,
) -> tuple[list[dict], str | None]:
    try:
        query = client.supabase.table(table).select(select)
        if cutoff_column:
            query = query.gte(cutoff_column, cutoff)
        result = query.order(order_column, desc=True).limit(limit).execute()
        return result.data or [], None
    except Exception as exc:
        return [], str(exc)


def _count_shadow_log_actions(shadow_logs: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for log in shadow_logs:
        action = (log.get('metadata') or {}).get('action') or {}
        action_type = action.get('type', 'unknown')
        counts[action_type] = counts.get(action_type, 0) + 1
    return counts


def _print_capacity_reconciler_report(report: dict) -> None:
    print("  " + "\u2500" * 3 + " Capacity Reconciler " + "\u2500" * 3)
    print()
    errors = {key: value for key, value in report.get('errors', {}).items() if value}
    if errors:
        print("  Capacity tables unavailable or partially unavailable:")
        for key, value in errors.items():
            print(f"    {key}: {value}")
        print()
        return

    print(
        "  Intent rows: "
        f"{report['intent_rows']} "
        f"(shadow={report['shadow_intent_rows']}, authoritative={report['authoritative_intent_rows']})"
    )
    print(f"  Shadow intended log rows: {report['shadow_intended_log_rows']}")
    print(f"  Shadow action counts: {report['shadow_action_counts'] or {}}")
    print(f"  Intent action counts: {report['intent_action_counts'] or {}}")
    print(f"  Suppressed action counts: {report['suppressed_action_counts'] or {}}")
    print(f"  Legacy worker mutation counts: {report.get('legacy_worker_mutation_counts') or {}}")
    print(f"  Divergence counts: {report.get('divergence_counts') or {}}")
    print(f"  Route-demand fallback rows: {report['route_demand_fallback_rows']}")
    print(f"  Lease-suppressed rows: {report['lease_suppressed_rows']}")
    print()

    if report.get('pool_stability'):
        print("  Pool intent stability:")
        for pool in report['pool_stability']:
            print(
                f"    {pool['pool']}: latest desired={pool['latest_desired_capacity']} "
                f"effective={pool['latest_effective_capacity']} "
                f"changes={pool['desired_capacity_changes']} "
                f"reason={pool['latest_reason']} stable_since={pool['latest_stable_since']}"
            )
        print()

    if report.get('route_backoffs'):
        print("  Active route backoff windows:")
        for row in report['route_backoffs']:
            print(
                f"    {row.get('pool')}/{row.get('route_key')}: "
                f"failures={row.get('consecutive_spawn_failures')} "
                f"next_spawn_allowed_at={row.get('next_spawn_allowed_at')} "
                f"last_error={row.get('last_error')}"
            )
        print()

    if report.get('latest_adoptions'):
        print("  Latest adoption intents:")
        for adoption in report['latest_adoptions']:
            print(
                f"    {adoption['created_at']} pool={adoption['pool']} "
                f"cycle={adoption['cycle_id']} workers={adoption['worker_ids']}"
            )
        print()

    duplicate_observations = report.get('duplicate_shadow_observations') or []
    duplicate_cycles = report.get('authoritative_cycle_duplicates') or []
    if duplicate_observations or duplicate_cycles:
        print("  Invariant warnings:")
        for row in duplicate_observations:
            print(
                f"    duplicate shadow observation observer={row['observer_id']} "
                f"observation={row['observation_id']} rows={row['rows']}"
            )
        for row in duplicate_cycles:
            print(
                f"    authoritative rows for pool={row['pool']} "
                f"cycle={row['cycle_id']}: {row['rows']}"
            )
        print()

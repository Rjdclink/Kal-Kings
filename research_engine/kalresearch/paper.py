"""Append-only simulation journal. No venue execution, balances or positions."""
import hashlib
import json
import sqlite3


def record(path, run_id, payload):
    if not run_id or len(run_id) > 200:
        raise ValueError('A bounded unique run id is required')
    body = json.dumps(payload, sort_keys=True, separators=(',', ':'), allow_nan=False)
    digest = hashlib.sha256(body.encode()).hexdigest()
    with sqlite3.connect(path, timeout=10) as connection:
        connection.execute('CREATE TABLE IF NOT EXISTS simulation_runs (run_id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, payload TEXT NOT NULL, recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
        connection.execute('BEGIN IMMEDIATE')
        previous = connection.execute('SELECT sha256 FROM simulation_runs WHERE run_id=?', (run_id,)).fetchone()
        if previous:
            if previous[0] != digest:
                raise ValueError('Run id already used with different inputs or results')
            return False
        connection.execute('INSERT INTO simulation_runs(run_id,sha256,payload) VALUES(?,?,?)', (run_id, digest, body))
    return True

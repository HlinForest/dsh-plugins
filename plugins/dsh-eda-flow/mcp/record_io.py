"""Transactional CAD records shared with Node. Files are exports, not IPC."""
import hashlib
import json
import os
import sqlite3
from pathlib import Path

DATABASE = '.eda-records.sqlite'

def local(path):
    value = os.path.abspath(path)
    if os.name == 'nt' and not value.startswith('\\\\?\\'):
        value = '\\\\?\\UNC\\' + value[2:] if value.startswith('\\\\') else '\\\\?\\' + value
    return Path(value)

def stored_text(path):
    path = local(path)
    database = path.parent / DATABASE
    if not database.exists():
        return None
    # Read-only URI avoids accidentally creating a replacement after a failure.
    uri_path = str(database)
    if uri_path.startswith('\\\\?\\UNC\\'):
        uri_path = '\\\\' + uri_path[8:]
    elif uri_path.startswith('\\\\?\\'):
        uri_path = uri_path[4:]
    connection = sqlite3.connect(Path(uri_path).as_uri() + '?mode=ro', uri=True, timeout=10)
    try:
        row = connection.execute('SELECT body,sha256 FROM records WHERE name=?', (path.name,)).fetchone()
        if row is None:
            return None
        if hashlib.sha256(row[0].encode('utf-8')).hexdigest() != row[1]:
            raise ValueError('Record database checksum mismatch: ' + str(path))
        return row[0]
    finally:
        connection.close()

def read_text(path):
    text = stored_text(path)
    return text if text is not None else local(path).read_text(encoding='utf-8-sig')

def read_json(path):
    return json.loads(read_text(path))

def store_text(path, text):
    path = local(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path.parent / DATABASE, timeout=10)
    try:
        with connection:
            connection.execute('CREATE TABLE IF NOT EXISTS records (name TEXT PRIMARY KEY, body TEXT NOT NULL, sha256 TEXT NOT NULL)')
            connection.execute('INSERT INTO records VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET body=excluded.body,sha256=excluded.sha256 WHERE records.body != excluded.body',
                               (path.name, text, hashlib.sha256(text.encode('utf-8')).hexdigest()))
    finally:
        connection.close()

def write_json(path, value):
    text = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)
    store_text(path, text)
    local(path).write_text(text, encoding='utf-8')

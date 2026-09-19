"""One-way read-only books mirror. Cloud edits are deliberately not supported yet."""
import hashlib
import json
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from cloud_backup import open_db

ENTITIES = ('accounts','account_anchors','paychecks','recurring_rules','transactions',
            'cc_snapshots','customers','products','documents','document_lines','pay_period_archives')
PROFILE_KEYS = {'company_name','company_address','company_phone','company_email','company_website',
                'default_tax_rate','default_terms','invoice_prefix','estimate_prefix'}
_guard = threading.Lock()
_started = False


def initialize(conn):
    conn.executescript('''
      CREATE TABLE IF NOT EXISTS books_sync_control(
        id INTEGER PRIMARY KEY CHECK(id=1), source_id TEXT NOT NULL, workspace_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 0, acknowledged INTEGER NOT NULL DEFAULT -1,
        last_success TEXT, error TEXT, lease REAL NOT NULL DEFAULT 0, attempted REAL NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS books_sync_events(id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS books_sync_ids(entity TEXT NOT NULL, local_key TEXT NOT NULL, sync_id TEXT NOT NULL UNIQUE,
        PRIMARY KEY(entity,local_key));
      CREATE TABLE IF NOT EXISTS books_sync_pending(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS books_sync_format(version INTEGER PRIMARY KEY);
    ''')
    conn.execute('INSERT OR IGNORE INTO books_sync_control(id,source_id) VALUES(1,?)', (str(uuid.uuid4()),))
    present = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    # Triggers run inside each original write transaction, including offline edits/deletes.
    for entity in (*ENTITIES, 'business_settings', 'settings'):
        if entity not in present:
            continue
        for action in ('INSERT','UPDATE','DELETE'):
            conn.execute(f'''CREATE TRIGGER IF NOT EXISTS books_sync_{entity}_{action}
                AFTER {action} ON {entity} BEGIN
                INSERT INTO books_sync_events(entity) VALUES('{entity}'); END''')
    if not conn.execute('SELECT 1 FROM books_sync_format WHERE version=2').fetchone():
        conn.execute('INSERT INTO books_sync_format VALUES(2)')
        conn.execute("INSERT INTO books_sync_events(entity) VALUES('settings')")


def ensure(path):
    with open_db(path) as conn:
        initialize(conn)


def state(path):
    ensure(path)
    with open_db(path) as conn:
        conn.row_factory = sqlite3.Row
        result = dict(conn.execute('SELECT * FROM books_sync_control WHERE id=1').fetchone())
        revision = conn.execute('SELECT COALESCE(MAX(id),0) FROM books_sync_events').fetchone()[0]
    result['enabled'] = bool(result['enabled'])
    result['running'] = result.pop('lease') > time.time()
    result['pending'] = max(0, revision-result['acknowledged'])
    result['status'] = ('Needs review' if result['error'] and result['error'].startswith('Needs review') else
                       'Offline' if result['error'] else 'Changes waiting' if result['pending'] else 'Synced')
    return result


def capture(path):
    with open_db(path) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute('BEGIN IMMEDIATE')
        queued = conn.execute('SELECT body FROM books_sync_pending WHERE id=1').fetchone()
        if queued:
            return json.loads(queued[0])
        control = conn.execute('SELECT * FROM books_sync_control WHERE id=1').fetchone()
        revision = conn.execute('SELECT COALESCE(MAX(id),0) FROM books_sync_events').fetchone()[0]
        records = []
        planner_settings = {}
        if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings'").fetchone():
            planner_settings = {k:v for k,v in conn.execute('SELECT key,value FROM settings')
                                if k in ('anchor_date','horizon_days','paycheck_account_id')}
        for entity in ENTITIES:
            columns = conn.execute(f'PRAGMA table_info({entity})').fetchall()
            if not columns:
                continue
            keys = [c['name'] for c in sorted(columns, key=lambda c:c['pk']) if c['pk']]
            if not keys:
                raise ValueError(f'Needs review: {entity} has no stable primary key.')
            for row in conn.execute(f'SELECT * FROM {entity}').fetchall():
                payload = dict(row)
                if entity == 'accounts':
                    payload['planner_settings'] = planner_settings
                # Acceptance tokens grant public actions; keep them out of the private mirror too.
                payload.pop('acceptance_token', None)
                key = json.dumps([row[k] for k in keys], separators=(',',':'))
                conn.execute('INSERT OR IGNORE INTO books_sync_ids VALUES(?,?,?)', (entity,key,str(uuid.uuid4())))
                sync_id = conn.execute('SELECT sync_id FROM books_sync_ids WHERE entity=? AND local_key=?',(entity,key)).fetchone()[0]
                records.append(dict(sync_id=sync_id,entity=entity,local_key=key,payload=payload))
        settings = dict(conn.execute('SELECT key,value FROM business_settings'))
        records.append(dict(sync_id=str(uuid.uuid5(uuid.UUID(control['source_id']),'business_profile')),
                            entity='business_profile',local_key='profile',payload={k:v for k,v in settings.items() if k in PROFILE_KEYS}))
        body = dict(p_workspace=control['workspace_id'],p_source=control['source_id'],p_revision=revision,p_records=records)
        conn.execute('INSERT INTO books_sync_pending VALUES(1,?,?)', (revision,json.dumps(body)))
        return body


def request_cloud(settings, route, payload=None):
    base = settings.get('supabase_url','').rstrip('/')
    key = settings.get('supabase_secret_key','')
    if urlparse(base).scheme!='https' or not key:
        raise ValueError('Needs review: save the Supabase connection in Business Profile.')
    headers = {'apikey':key,'Content-Type':'application/json'}
    if not key.startswith('sb_secret_'):
        headers['Authorization']='Bearer '+key
    req = Request(base+'/rest/v1/'+route,headers=headers,
                  data=json.dumps(payload).encode() if payload is not None else None)
    try:
        with urlopen(req,timeout=60) as response:
            return json.loads(response.read())
    except HTTPError as exc:
        raise ValueError(f'Needs review: cloud sync returned HTTP {exc.code}; check workspace/schema configuration.') from None
    except URLError:
        raise ConnectionError('Cloud unavailable; local changes are waiting.') from None


def sync(path, manual=False):
    ensure(path)
    now=time.time()
    with open_db(path) as conn:
        conn.row_factory=sqlite3.Row
        conn.execute('BEGIN IMMEDIATE')
        control=conn.execute('SELECT * FROM books_sync_control WHERE id=1').fetchone()
        if control['lease']>now or not control['workspace_id']:
            return
        if not manual and (not control['enabled'] or now-control['attempted']<60):
            return
        revision=conn.execute('SELECT COALESCE(MAX(id),0) FROM books_sync_events').fetchone()[0]
        if revision==control['acknowledged']:
            return
        conn.execute('UPDATE books_sync_control SET lease=?,attempted=? WHERE id=1',(now+300,now))
        settings=dict(conn.execute('SELECT key,value FROM business_settings'))
    try:
        body=capture(path)
        result=request_cloud(settings,'rpc/books_apply_snapshot',body)
        if result.get('revision')!=body['p_revision']:
            raise ValueError('Needs review: cloud acknowledged a different revision.')
        # Re-read the committed snapshot through a service-only RPC before acknowledging it locally.
        check=request_cloud(settings,'rpc/books_verify_snapshot',{'p_workspace':body['p_workspace']})
        expected={r['sync_id']:r['payload'] for r in body['p_records']}
        actual={r['sync_id']:r['payload'] for r in check['records']}
        if check['revision']!=body['p_revision'] or expected!=actual:
            raise ValueError('Needs review: cloud records differ from the captured local snapshot.')
        with open_db(path) as conn:
            conn.execute('UPDATE books_sync_control SET acknowledged=?,last_success=?,error=NULL WHERE id=1',
                         (body['p_revision'],datetime.now(timezone.utc).isoformat()))
            conn.execute('DELETE FROM books_sync_pending WHERE id=1')
    except Exception as exc:
        with open_db(path) as conn:
            conn.execute('UPDATE books_sync_control SET error=? WHERE id=1',
                         (str(exc) if isinstance(exc,(ValueError,ConnectionError)) else 'Cloud unavailable; local changes are waiting.',))
        raise
    finally:
        with open_db(path) as conn:
            conn.execute('UPDATE books_sync_control SET lease=0 WHERE id=1')


def register(app,path):
    from flask import jsonify,request
    @app.before_request
    def start():
        global _started
        if app.testing:
            return
        with _guard:
            if _started:
                return
            _started=True
        def worker():
            while True:
                try: sync(path)
                except Exception: pass
                time.sleep(15)
        threading.Thread(target=worker,daemon=True,name='sbooks-online-sync').start()

    @app.get('/api/online_sync')
    def get_status():
        return jsonify(state(path))

    @app.post('/api/online_sync')
    def update():
        if request.remote_addr not in ('127.0.0.1','::1') or not request.is_json:
            return jsonify(error='Local JSON requests only.'),403
        body=request.get_json()
        ensure(path)
        if body.get('owner_email'):
            current=state(path)
            if current['workspace_id']:
                return jsonify(error='Workspace is already connected.'),409
            with open_db(path) as conn:
                settings=dict(conn.execute('SELECT key,value FROM business_settings'))
            try:
                workspace=request_cloud(settings,'rpc/books_setup_workspace',{'p_source':current['source_id'],'p_email':str(body['owner_email']).strip()})
                uuid.UUID(workspace)
            except Exception:
                return jsonify(error='Setup failed. Apply the online-books SQL and confirm the owner sign-in email first.'),409
            with open_db(path) as conn:
                conn.execute('UPDATE books_sync_control SET workspace_id=? WHERE id=1',(workspace,))
        with open_db(path) as conn:
            if 'enabled' in body:
                if not isinstance(body['enabled'],bool):
                    return jsonify(error='enabled must be a boolean'),400
                conn.execute('UPDATE books_sync_control SET enabled=? WHERE id=1',(int(body['enabled']),))
        if body.get('sync_now'):
            if not state(path)['workspace_id']:
                return jsonify(error='Workspace setup is required before syncing.'),409
            try: sync(path,manual=True)
            except Exception: return jsonify(state(path)),502
        return jsonify(state(path))

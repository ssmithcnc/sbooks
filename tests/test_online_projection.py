"""Keep the read-only browser projection aligned with the original Flask rules."""
import json
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import app
import db
from online_sync import ENTITIES
from cloud_backup import open_db

ROOT=Path(__file__).resolve().parents[1]


class OnlineProjectionTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node') and (ROOT/'hosted-payments/node_modules/typescript/bin/tsc').exists(), 'Node and installed hosted app dependencies required')
    def test_archived_carryover_and_exact_payday_cards_match_local(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'fixture.db'
            with open_db(path) as conn:
                conn.executescript(db.SCHEMA_SQL)
                conn.executescript('''
                  ALTER TABLE cc_snapshots ADD COLUMN due_day TEXT;
                  ALTER TABLE cc_snapshots ADD COLUMN pay_status TEXT;
                  CREATE TABLE pay_period_archives(start_date TEXT PRIMARY KEY,archived_at TEXT);
                  INSERT INTO settings VALUES('anchor_date','2026-01-02'),('horizon_days','60'),('paycheck_account_id','1');
                  INSERT INTO accounts(id,name) VALUES(1,'Personal'),(2,'Business');
                  INSERT INTO account_anchors VALUES(1,'2026-01-02',100),(2,'2026-01-02',200);
                  INSERT INTO paychecks(account_id,date,amount) VALUES(1,'2026-01-02',1000),(1,'2026-01-16',1000);
                  INSERT INTO pay_period_archives VALUES('2026-01-02','2026-01-15');
                  INSERT INTO transactions(account_id,effective_date,amount,description,funding_bucket,created_at,updated_at)
                    VALUES(1,'2026-01-03',-12.34,'Archived expense','ONE_OFF','',''),(2,'2026-01-17',-50,'Business expense','ONE_OFF','','');
                  INSERT INTO cc_snapshots(name,snapshot_date,balance,side) VALUES('Card','0000-00-00',0,'personal'),('Card','2026-01-02',75,'personal');
                ''')
            @contextmanager
            def fixture_db():
                with open_db(path) as conn:
                    conn.row_factory=sqlite3.Row
                    yield conn
            with patch.object(app,'db',fixture_db),app.app.test_request_context('/api/projection'):
                expected=app.projection().get_json()
            with fixture_db() as conn:
                settings=dict(conn.execute('SELECT key,value FROM settings'))
                rows=[]
                for entity in ENTITIES:
                    for row in conn.execute('SELECT * FROM '+entity):
                        payload=dict(row)
                        if entity=='accounts': payload['planner_settings']=settings
                        rows.append(dict(entity=entity,sync_id=str(len(rows)),payload=payload))
            subprocess.run(['node',str(ROOT/'hosted-payments/node_modules/typescript/bin/tsc'),str(ROOT/'hosted-payments/app/books/projection.ts'),
                            '--target','es2020','--module','commonjs','--skipLibCheck','--outDir',temp],check=True,capture_output=True)
            script="const {project}=require(process.argv[1]);let data='';process.stdin.on('data',s=>data+=s);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(project(JSON.parse(data)))));"
            actual=json.loads(subprocess.run(['node','-e',script,str(Path(temp)/'projection.js')],input=json.dumps(rows),text=True,capture_output=True,check=True).stdout)
            self.assertEqual(len(actual['periods']),1)
            for a,b in zip(expected['periods'],actual['periods']):
                self.assertEqual(a['start_date'],b['start_date'])
                self.assertEqual(a['three_paycheck_month'],b['three_paycheck_month'])
                for side in ('cc','cc_biz'):
                    self.assertEqual(a[side]['total'],b[side]['total'])
                for old,new in zip(a['accounts'],b['accounts']):
                    for key in ('start_balance','end_balance'):
                        self.assertEqual(old[key],new[key])
                    self.assertEqual([(d['date'],d['balance']) for d in old['days']],[(d['date'],d['balance']) for d in new['days']])

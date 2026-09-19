import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import online_sync as sync
from cloud_backup import open_db


class OnlineSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'books.db'
        with open_db(self.path) as conn:
            conn.executescript('''CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT);
                CREATE TABLE business_settings(key TEXT PRIMARY KEY,value TEXT);
                INSERT INTO customers VALUES(1,'Original');
                INSERT INTO business_settings VALUES('company_name','Example');
                INSERT INTO business_settings VALUES('supabase_secret_key','never-sync-this');
                INSERT INTO business_settings VALUES('smtp_password','never-sync-password');''')
        sync.ensure(self.path)
        with open_db(self.path) as conn:
            conn.execute("UPDATE books_sync_control SET workspace_id='11111111-1111-4111-8111-111111111111' WHERE id=1")

    def test_edit_and_outbox_rollback_together(self):
        before=sync.state(self.path)['pending']
        with self.assertRaises(RuntimeError):
            with open_db(self.path) as conn:
                conn.execute("UPDATE customers SET name='Changed' WHERE id=1")
                raise RuntimeError('rollback')
        self.assertEqual(sync.state(self.path)['pending'],before)
        with open_db(self.path) as conn:
            self.assertEqual(conn.execute('SELECT name FROM customers').fetchone()[0],'Original')

    def test_retry_reuses_capture_while_new_edits_wait(self):
        first=sync.capture(self.path)
        with open_db(self.path) as conn:
            conn.execute("UPDATE customers SET name='New edit' WHERE id=1")
        self.assertEqual(sync.capture(self.path),first)
        with open_db(self.path) as conn:
            conn.execute('DELETE FROM books_sync_pending')
        second=sync.capture(self.path)
        self.assertGreater(second['p_revision'],first['p_revision'])
        self.assertEqual(second['p_records'][0]['sync_id'],first['p_records'][0]['sync_id'])

    def test_secrets_not_in_payload(self):
        data=str(sync.capture(self.path))
        self.assertNotIn('never-sync',data)
        self.assertNotIn('smtp_password',data)

    def test_disabled_does_not_call_cloud(self):
        with patch.object(sync,'request_cloud') as request:
            sync.sync(self.path)
            request.assert_not_called()

    def test_verified_retry_then_delete(self):
        cloud={}
        def remote(settings,route,body):
            if route.endswith('books_apply_snapshot'):
                cloud.update(body)
                return {'revision':body['p_revision']}
            return {'revision':cloud['p_revision'],'records':cloud['p_records']}
        with patch.object(sync,'request_cloud',side_effect=remote):
            sync.sync(self.path,manual=True)
            self.assertEqual(sync.state(self.path)['status'],'Synced')
            with open_db(self.path) as conn:
                conn.execute('DELETE FROM customers WHERE id=1')
            self.assertEqual(sync.state(self.path)['status'],'Changes waiting')
            sync.sync(self.path,manual=True)
            self.assertFalse(any(r['entity']=='customers' for r in cloud['p_records']))

    def test_failed_verification_keeps_outbox(self):
        def remote(settings,route,body):
            if route.endswith('books_apply_snapshot'):
                return {'revision':body['p_revision']}
            return {'revision':0,'records':[]}
        with patch.object(sync,'request_cloud',side_effect=remote):
            with self.assertRaises(ValueError):
                sync.sync(self.path,manual=True)
        self.assertEqual(sync.state(self.path)['status'],'Needs review')
        with open_db(self.path) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM books_sync_pending').fetchone()[0],1)
            self.assertEqual(conn.execute('SELECT acknowledged FROM books_sync_control').fetchone()[0],-1)


if __name__=='__main__':
    unittest.main()

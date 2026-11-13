import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('migration', Path(__file__).parents[1]/'tools/migrate.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def fixture(path, status='enabled', orphan=False, overlap=False):
    tables = {
        'bs_users': [dict(uid='1',alias='Example',status=status,email='member@example.invalid',
                          pw='$2y$06$'+'A'*53,login_attempts='0',login_detent=None,last_ip='192.0.2.1')],
        'bs_squares': [dict(sid='1',name='Court 1')],
        'bs_bookings': [dict(bid='1',uid='1',sid='1',status='single',status_billing='paid',
                            visibility='private',quantity='2',created='2026-01-01 12:00:00')],
        'bs_reservations': [dict(rid='1',bid='99' if orphan else '1',date='2026-06-01',time_start='23:00:00',time_end='24:00:00')],
        'bs_users_meta': [dict(umid='1',uid='1',key='legacy-pw',value='do-not-copy')],
    }
    if overlap:
        tables['bs_reservations'].append(dict(rid='2',bid='1',date='2026-06-01',time_start='23:30:00',time_end='24:00:00'))
    text = ''
    for table, rows in tables.items():
        keys = list(rows[0])
        text += f'CREATE TABLE `{table}` (\n'+',\n'.join(f'  `{key}` text' for key in keys)+'\n);\n'
        text += f'INSERT INTO `{table}` ('+', '.join(f'`{k}`' for k in keys)+') VALUES\n'
        text += ',\n'.join('('+','.join('NULL' if r[k] is None else "'"+r[k].replace("'","''")+"'" for k in keys)+')' for r in rows)+';\n'
    path.write_text(text,encoding='utf-8')


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)/'source.sql'
        self.db = sqlite3.connect(':memory:')
        m.create_schema(self.db)
        fixture(self.path)

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def run_import(self, club='one'):
        with self.db:
            return m.import_club(self.db,club,self.path)

    def test_parser_escaping_null_and_semicolon(self):
        text = "('a; b',NULL,'NULL','O''Brien','x\\ny'),('2',1,2,3,4);"
        rows,end = m.parse_values(text,0)
        self.assertEqual(rows[0],['a; b',None,'NULL',"O'Brien",'x\ny'])
        self.assertEqual(end,len(text))

    def test_parser_rejects_expressions(self):
        with self.assertRaises(ValueError):
            m.parse_values('(1, NOW());',0)

    def test_rerun_and_club_isolation(self):
        a = self.run_import()
        self.run_import('two')
        self.assertEqual(a,self.run_import())
        self.assertEqual(self.db.execute('SELECT count(*) FROM accounts').fetchone()[0],2)
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_no_legacy_credentials_or_automatic_privileges(self):
        fixture(self.path,status='admin')
        self.run_import()
        state,role = self.db.execute('SELECT activation_state,role FROM accounts').fetchone()
        self.assertEqual((state,role),('review_required','none'))
        payload = '\n'.join(r[0] for r in self.db.execute('SELECT payload_json FROM source_records'))
        for secret in ('$2y$', '192.0.2.1', 'do-not-copy', 'login_detent'):
            self.assertNotIn(secret,payload)

    def test_inactive_accounts_stay_inactive(self):
        for status in ('blocked','deleted','disabled','placeholder'):
            fixture(self.path,status=status)
            self.run_import()
            self.assertEqual(self.db.execute('SELECT activation_state FROM accounts').fetchone()[0],'inactive')

    def test_orphan_preserved_and_quarantined(self):
        fixture(self.path,orphan=True)
        report=self.run_import()
        self.assertEqual(report['issues']['orphan_reservation'],1)
        self.assertEqual(report['normalized_counts']['occurrences'],0)
        self.assertEqual(self.db.execute("SELECT count(*) FROM source_records WHERE source_table='bs_reservations'").fetchone()[0],1)

    def test_overlap_detected_and_midnight_normalized(self):
        fixture(self.path,overlap=True)
        report=self.run_import()
        self.assertEqual(report['issues']['overlapping_reservations'],1)
        self.assertEqual(self.db.execute('SELECT ends_local FROM occurrences LIMIT 1').fetchone()[0],'2026-06-02T00:00:00')
        with self.assertRaises(ValueError):
            m.local_interval('2026-06-01','16:00:00','16:00:00')

    def test_invalid_source_rolls_back_previous_import(self):
        original=self.run_import()
        fixture(self.path,status='unknown')
        with self.assertRaises(ValueError):
            self.run_import()
        self.assertEqual(self.db.execute('SELECT sha256 FROM sources').fetchone()[0],original['source_sha256'])


if __name__ == '__main__':
    unittest.main()

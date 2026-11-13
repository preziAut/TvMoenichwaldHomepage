"""Static, offline inspection. Never executes PHP or imports the SQL dump."""
from pathlib import Path
import re, json, collections, hashlib

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'Wiederherstellung/Berichte'
WP = ROOT / 'FTPArchiv/_/wp'

def php_array(text):
    raw = text.encode('utf-8'); i = 0
    def parse():
        nonlocal i
        typ = chr(raw[i]); i += 2
        if typ == 's':
            j=raw.index(b':',i); n=int(raw[i:j]); i=j+2
            val=raw[i:i+n].decode('utf-8'); i+=n+2; return val
        if typ == 'a':
            j=raw.index(b':',i); n=int(raw[i:j]); i=j+2; val={}
            for _ in range(n):
                key=parse(); val[key]=parse()
            assert raw[i:i+1]==b'}'; i+=1; return val
        if typ in ('i','b','d'):
            j=raw.index(b';',i); val=raw[i:j].decode(); i=j+1; return val
        raise ValueError('Unsupported serialization type '+typ)
    return parse()

def rows(path=None):
    table = None
    for no, line in enumerate((path or ROOT/'SQLServerBackups/mysqlsvr71_world4you_com.sql').read_text(encoding='utf-8-sig').splitlines(), 1):
        if line.startswith('INSERT INTO '):
            table = re.search(r'`([^`]+)`', line)[1]
        elif table and line.startswith('('):
            vals, i = [], 1
            while i < len(line):
                while i < len(line) and line[i].isspace(): i += 1
                if line[i] == "'":
                    i += 1; value = ''
                    while i < len(line):
                        c = line[i]; i += 1
                        if c == '\\':
                            c = line[i]; i += 1
                            value += {'n':'\n','r':'\r','t':'\t','0':'\0','Z':'\x1a'}.get(c,c)
                        elif c == "'":
                            if i < len(line) and line[i] == "'": value += "'"; i += 1
                            else: break
                        else: value += c
                    vals.append(value)
                else:
                    end = i
                    while line[end] not in ',)': end += 1
                    vals.append(line[i:end].strip()); i = end
                while i < len(line) and line[i].isspace(): i += 1
                if line[i] == ')': break
                assert line[i] == ',', (no,i)
                i += 1
            yield table, no, vals
            if line.endswith(';'): table = None


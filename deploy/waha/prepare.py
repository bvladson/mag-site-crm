#!/usr/bin/env python3
"""Prepare private WAHA directories/credentials; never starts a WhatsApp session."""
import hashlib
import os
from pathlib import Path
import secrets
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '/opt/mag-whatsapp').resolve()
if root == Path('/') or root in [Path('/opt/mag-site'), Path('/srv/mag-site')]:
    raise SystemExit('Use a separate WAHA directory.')
root.mkdir(mode=0o700, parents=True, exist_ok=True)
private = root / 'secrets'
private.mkdir(mode=0o700, exist_ok=True)
api = private / 'api-key'
if not api.exists():
    fd = os.open(api, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(secrets.token_hex(32))
    os.chown(api, 65532, 65532)
value = api.read_text().strip()
if len(value) < 32:
    raise SystemExit('Invalid API credential; not replacing it.')
env = private / 'waha.env'
if not env.exists():
    fd = os.open(env, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write('WAHA_API_KEY=sha512:' + hashlib.sha512(value.encode()).hexdigest() + '\n')
for name in ['sessions', 'media']:
    directory = root / 'data' / name
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chown(directory, 65532, 65532)
    os.chmod(directory, 0o700)
print('Private WAHA configuration prepared. API credentials were not printed.')

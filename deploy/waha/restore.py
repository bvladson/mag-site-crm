#!/usr/bin/env python3
"""Restore into a NEW directory. Never starts a second copy of a live session."""
import os
from pathlib import Path
import sys
import tarfile

package = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
if destination.exists() or destination == Path('/'):
    raise SystemExit('Restore requires a new, empty target path.')
with tarfile.open(package) as archive:
    members = archive.getmembers()
    for member in members:
        name = Path(member.name)
        if name.is_absolute() or '..' in name.parts or member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
            raise SystemExit('Unsafe backup entry.')
        if name.parts[0] not in ['compose.yaml', '.env', 'secrets', 'data']:
            raise SystemExit('Unexpected backup entry.')
    destination.mkdir(mode=0o700, parents=True)
    archive.extractall(destination, filter='data')
for path in [destination, *destination.rglob('*')]:
    os.chmod(path, 0o700 if path.is_dir() else 0o600)
    if path.is_relative_to(destination / 'data') or path == destination / 'secrets/api-key':
        os.chown(path, 65532, 65532)
print('Restored offline. Keep the original instance stopped before starting this copy.')

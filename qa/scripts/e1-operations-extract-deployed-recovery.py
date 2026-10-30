"""Read the two approved deployed source archives; persist only recovery code.

No archive, environment file, credential or unrelated source is written to disk.
The archive references are the immutable generations observed on 2026-10-19.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import zipfile

root = Path(__file__).resolve().parents[2]
cli = Path(os.environ['LOCALAPPDATA']) / 'Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd'
sources = {
    'queueOperationRecovery': 'gs://gcf-v2-sources-751158244178-us-central1/queueOperationRecovery/function-source.zip#1791499292054448',
    'reconcileOperationRecovery': 'gs://gcf-v2-sources-751158244178-us-central1/reconcileOperationRecovery/function-source.zip#1791499422598307',
}
allowed = ('src/modules/controlCenter/recovery.ts', 'lib/modules/controlCenter/recovery.js')
for name, uri in sources.items():
    archive = subprocess.check_output([str(cli), 'storage', 'cat', uri, '--project=pay-0-system'], stderr=subprocess.PIPE)
    if len(archive) > 64 * 1024 * 1024:
        raise RuntimeError('Unexpected source size; refuse extraction')
    output = root / 'tmp/e1-deployed-recovery' / name
    output.mkdir(parents=True, exist_ok=True)
    entries = []
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        for item in source.infolist():
            normalized = item.filename.replace('\\', '/')
            if not any(normalized == suffix or normalized.endswith('/' + suffix) for suffix in allowed):
                continue
            content = source.read(item)
            target = output / Path(normalized).name
            target.write_bytes(content)
            entries.append({'file': target.name, 'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)})
    if not entries:
        raise RuntimeError('Recovery module absent from approved archive')
    print(json.dumps({'function': name, 'archiveSha256': hashlib.sha256(archive).hexdigest(), 'selectedFiles': entries}))

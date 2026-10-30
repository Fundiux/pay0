"""Build private recovery overlays, retaining all unchanged ZIP local records."""
import copy, hashlib, io, json, os, struct, subprocess, zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[2]
sha = lambda value: hashlib.sha256(value).hexdigest()
commit = '5b0db917bd70e76c160339e506f7c7d4467376b7'
target = 'lib/modules/controlCenter/recovery.js'
replacement = (root / 'functions' / target).read_bytes()
assert sha(replacement) == '13d61680f7ef6d89b8ea57dd15d3b02e1a5cb14a222109c9cd0171df46f5775b', 'Compiled recovery drift: re-review before packaging'
typescript_path = 'functions/src/modules/controlCenter/recovery.ts'
committed_source = subprocess.check_output(['git', 'show', commit + ':' + typescript_path], cwd=root)
assert (root / typescript_path).read_bytes().replace(b'\r\n', b'\n') == committed_source.replace(b'\r\n', b'\n'), 'Recovery source no longer matches reviewed patch commit'
cli = Path(os.environ['LOCALAPPDATA']) / 'Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd'
sources = [('queueOperationRecovery', 'queue', '1791499292054448'), ('reconcileOperationRecovery', 'reconcile', '1791499422598307')]
for name, short, generation in sources:
    uri = f'gs://gcf-v2-sources-751158244178-us-central1/{name}/function-source.zip#{generation}'
    original = subprocess.check_output([str(cli), 'storage', 'cat', uri, '--project=pay-0-system'], stderr=subprocess.PIPE)
    assert sha(original) == '6e600ff51ba1df79097b778664c1081e2271b59dec2c71103d5e74b64aaa0df4'
    source = zipfile.ZipFile(io.BytesIO(original))
    infos = source.infolist()
    assert target in source.namelist()
    for info in infos:
        assert not info.filename.startswith('/') and '\\' not in info.filename and ':' not in info.filename
        assert '..' not in info.filename.split('/') and not any(p.startswith('.env') for p in info.filename.split('/'))
    temp = io.BytesIO()
    with zipfile.ZipFile(temp, 'w') as single:
        single.writestr(copy.copy(source.getinfo(target)), replacement)
    changed = temp.getvalue()
    one = zipfile.ZipFile(io.BytesIO(changed))
    offsets = {}
    ordered = sorted(infos, key=lambda item: item.header_offset)
    output = bytearray(original[:ordered[0].header_offset])
    for index, info in enumerate(ordered):
        offsets[info.filename] = len(output)
        end = ordered[index + 1].header_offset if index + 1 < len(ordered) else source.start_dir
        output.extend(changed[:one.start_dir] if info.filename == target else original[info.header_offset:end])
    central_start = len(output)
    position = source.start_dir
    for info in infos:
        assert original[position:position + 4] == b'PK\x01\x02'
        n, e, c = struct.unpack_from('<HHH', original, position + 28)
        length = 46 + n + e + c
        record = bytearray(changed[one.start_dir:changed.rfind(b'PK\x05\x06')] if info.filename == target else original[position:position + length])
        struct.pack_into('<I', record, 42, offsets[info.filename])
        output.extend(record)
        position += length
    central_size = len(output) - central_start
    assert original[position:position + 4] == b'PK\x05\x06', 'ZIP64/digital signatures not supported'
    tail = bytearray(original[position:])
    struct.pack_into('<II', tail, 12, central_size, central_start)
    output.extend(tail)
    result = bytes(output)
    verified = zipfile.ZipFile(io.BytesIO(result))
    assert verified.namelist() == source.namelist()
    for info in infos:
        assert verified.read(info.filename) == (replacement if info.filename == target else source.read(info.filename))
    directory = root / '.firebase/modular-release' / f'recovery-{short}-{commit[:12]}'
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / 'source.zip'
    archive.write_bytes(result)
    manifest = {'schemaVersion': 1, 'state': 'EXACT_ARTIFACT_UNVERIFIED_RUNTIME', 'sourceCommit': commit, 'sourceTree': None, 'archive': str(archive), 'archiveSha256': sha(result), 'group': f'operation-recovery-{short}-overlay', 'buildMode': 'NORMAL', 'functions': [name], 'compiledFiles': sum(i.filename.endswith('.js') for i in infos), 'sourceIdentity': {'mode': 'PRODUCTION_OVERLAY_V1', 'baseArchiveSha256': sha(original), 'patchCommit': commit, 'patchSha256': sha(replacement)}, 'preservation': {'onlyReplacement': target, 'otherEntriesByteIdentical': len(infos)-1, 'unchangedLocalRecordsPreserved': True, 'packageAndLockPreserved': True}}
    (directory / 'input.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'function': name, 'archiveSha256': sha(result), 'entries': len(infos), 'directory': str(directory)}))

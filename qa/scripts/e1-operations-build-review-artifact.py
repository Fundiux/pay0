"""Prepare two new callables over an existing, read-only production source base."""
import copy, hashlib, io, json, os, re, subprocess, zipfile
from pathlib import Path
root = Path(__file__).resolve().parents[2]
directory = root / '.firebase/modular-release/new-recovery-review'
baseline_bytes = (directory / 'baseline.json').read_bytes()
baseline = json.loads(baseline_bytes)
resource = baseline['functions']['getControlCenterEngineering']['resource']
source = resource['buildConfig'].get('sourceProvenance', {}).get('resolvedStorageSource') or resource['buildConfig']['source']['storageSource']
assert re.fullmatch(r'gcf-v2-sources-\d+-us-central1', source['bucket'])
assert source['object'] == 'getControlCenterEngineering/function-source.zip'
assert re.fullmatch(r'\d+', str(source['generation']))
cli = Path(os.environ['LOCALAPPDATA']) / 'Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd'
uri = f"gs://{source['bucket']}/{source['object']}#{source['generation']}"
original = subprocess.check_output([str(cli), 'storage', 'cat', uri, '--project=pay-0-system'], stderr=subprocess.PIPE)
assert len(original) < 64 * 1024 * 1024
sha = lambda data: hashlib.sha256(data).hexdigest()
module = 'lib/modules/controlCenter/recoveryReviewCallables.js'
typescript = 'functions/src/modules/controlCenter/recoveryReviewCallables.ts'
commit = subprocess.check_output(['git', 'log', '-1', '--format=%H', '--', typescript], cwd=root, text=True).strip()
assert (root / typescript).read_bytes().replace(b'\r\n', b'\n') == subprocess.check_output(['git', 'show', commit + ':' + typescript], cwd=root).replace(b'\r\n', b'\n')
replacement = (root / 'functions' / module).read_bytes()
compiled = subprocess.check_output(['node', '-e', "const fs=require('fs'),ts=require('./functions/node_modules/typescript');const config=ts.parseJsonConfigFileContent(ts.readConfigFile('functions/tsconfig.json',ts.sys.readFile).config,ts.sys,'functions');process.stdout.write(ts.transpileModule(fs.readFileSync(process.argv[1],'utf8'),{compilerOptions:config.options,fileName:'recoveryReviewCallables.ts'}).outputText)", typescript], cwd=root)
assert compiled.replace(b'\r\n', b'\n') == replacement.replace(b'\r\n', b'\n'), 'Compiled review module differs from independently emitted committed source'
names = ['listOperationRecoveryReviews', 'acknowledgeOperationRecoveryReview']
before = zipfile.ZipFile(io.BytesIO(original))
assert module not in before.namelist()
index = before.read('lib/index.js')
assert all(('exports.' + name).encode() not in index for name in names)
context = before.read('lib/modules/controlCenter/callables.js')
assert b'exports.context = context' in context
assert b'requiredModule: "reportes", requiredAction: "view"' in context
addition = b'\n// Additive recovery review callables; existing exports are preserved.\n' + b''.join(f'Object.defineProperty(exports, "{name}", {{ enumerable: true, get: function () {{ return require("./modules/controlCenter/recoveryReviewCallables").{name}; }} }});\n'.encode() for name in names)
output = io.BytesIO()
with zipfile.ZipFile(output, 'w') as after:
    for info in before.infolist():
        assert not info.filename.startswith('/') and '\\' not in info.filename and ':' not in info.filename
        assert '..' not in info.filename.split('/') and not any(part.startswith('.env') for part in info.filename.split('/'))
        after.writestr(copy.copy(info), index + addition if info.filename == 'lib/index.js' else before.read(info))
    new = zipfile.ZipInfo(module, (2026, 1, 1, 0, 0, 0)); new.compress_type = zipfile.ZIP_DEFLATED
    after.writestr(new, replacement)
archive = output.getvalue()
verified = zipfile.ZipFile(io.BytesIO(archive))
assert set(verified.namelist()) == set(before.namelist()) | {module}
for info in before.infolist():
    assert verified.read(info.filename) == (index + addition if info.filename == 'lib/index.js' else before.read(info))
archive_path = directory / 'source.zip'
archive_path.write_bytes(archive)
patch_identity = json.dumps({'module': module, 'moduleSha256': sha(replacement), 'indexBeforeSha256': sha(index), 'indexAfterSha256': sha(index + addition)}, sort_keys=True, separators=(',', ':')).encode()
manifest = {'schemaVersion': 1, 'state': 'PREPARED_NEW_FUNCTIONS_AWAITING_CREATE_POLICY_AND_RUNTIME_PROOF', 'group': 'operation-recovery-review-new', 'functions': names, 'sourceCommit': commit, 'sourceTree': None, 'archive': str(archive_path), 'archiveSha256': sha(archive), 'baselineFile': str(directory / 'baseline.json'), 'baselineSha256': sha(baseline_bytes), 'buildMode': 'NORMAL', 'sourceIdentity': {'mode': 'ADDITIVE_NEW_FUNCTIONS_V1', 'baseArchiveSha256': sha(original), 'patchCommit': commit, 'patchSha256': sha(patch_identity)}, 'patch': {'newModule': module, 'newModuleSha256': sha(replacement), 'typescriptSha256': sha((root / typescript).read_bytes()), 'independentTranspileSha256': sha(compiled), 'indexBeforeSha256': sha(index), 'indexAfterSha256': sha(index + addition), 'otherFileContentsPreserved': len(before.infolist()) - 1}, 'productionWrites': 0}
(directory / 'input.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps({'archiveSha256': sha(archive), 'baseArchiveSha256': sha(original), 'sourceCommit': commit, 'unchangedFileContents': len(before.infolist()) - 1, 'state': manifest['state']}))

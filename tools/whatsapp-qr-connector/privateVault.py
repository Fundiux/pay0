"""Windows current-user DPAPI vault. Secret JSON is accepted/returned on pipes,
never arguments or logs. No network, environment credentials, shells or session IO.
Called explicitly by workerEnrollment.cjs; importing this file does nothing.
"""
import ctypes as c
from ctypes import wintypes as w
import json, os, pathlib, sys, uuid

PHASE = 'INITIAL'

class Blob(c.Structure):
    _fields_ = [('size', w.DWORD), ('data', c.POINTER(c.c_ubyte))]

def main():
    global PHASE
    if os.name != 'nt' or len(sys.argv) != 3: raise ValueError('WINDOWS_VAULT_ARGUMENTS')
    operation, filename = sys.argv[1:]
    if operation not in {'create', 'load', 'binding'}: raise ValueError('VAULT_OPERATION')
    target = pathlib.Path(filename)
    if not target.is_absolute() or target.name != 'worker.dpapi' or target.parent.name != 'pay0-wa-worker-vault': raise ValueError('VAULT_PATH')
    # Reject redirects at every existing ancestor and the target. Never follow
    # another process's junction, symlink or hard-linked key file.
    for parent in [*reversed(target.parents), target]:
        if parent.exists():
            st = parent.lstat()
            if st.st_file_attributes & 1024 or parent.is_symlink() or parent.is_junction(): raise ValueError('VAULT_REPARSE')
    crypt = c.WinDLL('crypt32', use_last_error=True)
    adv = c.WinDLL('advapi32', use_last_error=True)
    kernel = c.WinDLL('kernel32', use_last_error=True)
    kernel.GetCurrentProcess.restype = w.HANDLE
    kernel.LocalFree.argtypes = [c.c_void_p]
    kernel.LocalFree.restype = c.c_void_p
    kernel.CloseHandle.argtypes = [w.HANDLE]
    adv.OpenProcessToken.argtypes = [w.HANDLE, w.DWORD, c.POINTER(w.HANDLE)]
    adv.GetTokenInformation.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.POINTER(w.DWORD)]
    adv.ConvertSidToStringSidW.argtypes = [c.c_void_p, c.POINTER(w.LPWSTR)]
    adv.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [w.LPCWSTR, w.DWORD, c.POINTER(c.c_void_p), c.POINTER(w.DWORD)]
    adv.SetFileSecurityW.argtypes = [w.LPCWSTR, w.DWORD, c.c_void_p]
    adv.GetNamedSecurityInfoW.argtypes = [w.LPWSTR, c.c_int, w.DWORD, c.POINTER(c.c_void_p), c.c_void_p, c.POINTER(c.c_void_p), c.c_void_p, c.POINTER(c.c_void_p)]
    adv.GetNamedSecurityInfoW.restype = w.DWORD
    adv.GetAce.argtypes = [c.c_void_p, w.DWORD, c.POINTER(c.c_void_p)]
    crypt.CryptProtectData.argtypes = [c.POINTER(Blob), w.LPCWSTR, c.POINTER(Blob), c.c_void_p, c.c_void_p, w.DWORD, c.POINTER(Blob)]
    crypt.CryptUnprotectData.argtypes = [c.POINTER(Blob), c.c_void_p, c.POINTER(Blob), c.c_void_p, c.c_void_p, w.DWORD, c.POINTER(Blob)]
    PHASE = 'TOKEN'
    token, length = w.HANDLE(), w.DWORD()
    if not adv.OpenProcessToken(kernel.GetCurrentProcess(), 8, c.byref(token)): raise c.WinError(c.get_last_error())
    try:
        adv.GetTokenInformation(token, 1, None, 0, c.byref(length))
        info = c.create_string_buffer(length.value)
        if not adv.GetTokenInformation(token, 1, info, length, c.byref(length)): raise c.WinError(c.get_last_error())
        sid_pointer = c.cast(info, c.POINTER(c.c_void_p))[0]
        sid_text = w.LPWSTR()
        if not adv.ConvertSidToStringSidW(sid_pointer, c.byref(sid_text)): raise c.WinError(c.get_last_error())
        try: sid = sid_text.value
        finally: kernel.LocalFree(sid_text)
        app_sid = None
        is_app = w.DWORD()
        if not adv.GetTokenInformation(token, 29, c.byref(is_app), c.sizeof(is_app), c.byref(length)): raise c.WinError(c.get_last_error())
        if is_app.value:
            adv.GetTokenInformation(token, 31, None, 0, c.byref(length))
            app_info = c.create_string_buffer(length.value)
            if not adv.GetTokenInformation(token, 31, app_info, length, c.byref(length)): raise c.WinError(c.get_last_error())
            app_pointer = c.cast(app_info, c.POINTER(c.c_void_p))[0]
            app_text = w.LPWSTR()
            if not adv.ConvertSidToStringSidW(app_pointer, c.byref(app_text)): raise c.WinError(c.get_last_error())
            try: app_sid = app_text.value
            finally: kernel.LocalFree(app_text)
    finally: kernel.CloseHandle(token)
    descriptor = c.c_void_p()
    # A protected DACL allows only this Windows user. DPAPI additionally binds
    # ciphertext to the current user's protection context, not machine scope.
    sddl = 'D:P(A;;FA;;;' + sid + ')' + ('(A;;FA;;;' + app_sid + ')' if app_sid else '')
    if not adv.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, c.byref(descriptor), None): raise c.WinError(c.get_last_error())
    def sid_string(pointer):
        text = w.LPWSTR()
        if not adv.ConvertSidToStringSidW(pointer, c.byref(text)): raise c.WinError(c.get_last_error())
        try: return text.value
        finally: kernel.LocalFree(text)
    def assert_private_acl(path):
        owner, dacl, security = c.c_void_p(), c.c_void_p(), c.c_void_p()
        result = adv.GetNamedSecurityInfoW(str(path), 1, 5, c.byref(owner), None, c.byref(dacl), None, c.byref(security))
        if result: raise c.WinError(result)
        try:
            if not owner.value or sid_string(owner) != sid or not dacl.value: raise ValueError('VAULT_OWNER_OR_NULL_DACL')
            # Restricted tokens cannot rewrite ACLs. Accept only an already
            # private executor-created ACL: user, this exact AppContainer, and
            # Windows SYSTEM/Administrators. No other user/group/package SID.
            allowed = {sid, app_sid, 'S-1-5-18', 'S-1-5-32-544'}
            count = c.c_ushort.from_address(dacl.value + 4).value
            if not count: raise ValueError('VAULT_EMPTY_DACL')
            observed = set()
            for index in range(count):
                ace = c.c_void_p()
                if not adv.GetAce(dacl, index, c.byref(ace)): raise c.WinError(c.get_last_error())
                if c.c_ubyte.from_address(ace.value).value != 0: raise ValueError('VAULT_COMPLEX_ACE')
                trustee = sid_string(c.c_void_p(ace.value + 8))
                if trustee not in allowed: raise ValueError('VAULT_UNEXPECTED_PRINCIPAL')
                observed.add(trustee)
            if sid not in observed or (app_sid and app_sid not in observed): raise ValueError('VAULT_EXECUTOR_ACL_REQUIRED')
        finally: kernel.LocalFree(security)
    def protect_acl(path):
        global PHASE
        PHASE = 'SET_PRIVATE_ACL'
        if app_sid:
            assert_private_acl(path)
        elif not adv.SetFileSecurityW(str(path), 0x80000004, descriptor): raise c.WinError(c.get_last_error())
    def blob(value):
        memory = c.create_string_buffer(value)
        return Blob(len(value), c.cast(memory, c.POINTER(c.c_ubyte))), memory
    entropy, entropy_memory = blob(b'PAY0-WHATSAPP-WORKER-VAULT-V1')
    def transform(value, encrypt):
        global PHASE
        PHASE = 'DPAPI_ENCRYPT' if encrypt else 'DPAPI_DECRYPT'
        source, source_memory = blob(value); output = Blob()
        ok = crypt.CryptProtectData(c.byref(source), 'PAY0 WhatsApp local worker', c.byref(entropy), None, None, 1, c.byref(output)) if encrypt else crypt.CryptUnprotectData(c.byref(source), None, c.byref(entropy), None, None, 1, c.byref(output))
        if not ok: raise c.WinError(c.get_last_error())
        try: return c.string_at(output.data, output.size)
        finally: kernel.LocalFree(output.data)
    try:
        if operation == 'create':
            if target.exists(): raise ValueError('VAULT_EXISTS')
            value = json.loads(sys.stdin.buffer.read(16000))
            if set(value) != {'publicKeyPem', 'privateKeyPem'}: raise ValueError('VAULT_FIELDS')
            if not all(isinstance(v, str) and len(v) <= 4096 for v in value.values()): raise ValueError('VAULT_KEY_FIELDS')
            value = {'version': 1, **value, 'binding': None}
        else:
            if target.stat().st_nlink != 1 or target.stat().st_size > 20000: raise ValueError('VAULT_FILE_BOUNDARY')
            # Tighten an inherited ACL before decrypting, not after exposing key bytes.
            protect_acl(target.parent); protect_acl(target)
            value = json.loads(transform(target.read_bytes(), False))
            if value.get('version') != 1: raise ValueError('VAULT_VERSION')
            if operation == 'binding':
                incoming = json.loads(sys.stdin.buffer.read(16000))
                if set(incoming) != {'binding'} or not isinstance(incoming['binding'], dict): raise ValueError('VAULT_BINDING_FIELDS')
                value['binding'] = incoming['binding']
        if operation != 'load':
            target.parent.mkdir(exist_ok=True)
            protect_acl(target.parent)
            encrypted = transform(json.dumps(value, separators=(',', ':')).encode('utf-8'), True)
            temporary = target.parent / ('.worker-' + uuid.uuid4().hex + '.tmp')
            with temporary.open('xb') as stream:
                protect_acl(temporary)
                stream.write(encrypted); stream.flush(); os.fsync(stream.fileno())
            if operation == 'create' and target.exists(): raise ValueError('VAULT_CREATE_RACE')
            os.replace(temporary, target)
            protect_acl(target)
        # Only the internal load pipe returns private material. Other commands
        # return public pairing data, never a PEM/private key or decrypted blob.
        result = value if operation == 'load' else {'ok': True, 'publicKeyPem': value['publicKeyPem'], 'binding': value['binding']}
        sys.stdout.write(json.dumps(result))
    finally: kernel.LocalFree(descriptor)

if __name__ == '__main__':
    try: main()
    except Exception as error:
        sys.stderr.write('PRIVATE_VAULT_FAILED:' + type(error).__name__ + ':' + str(getattr(error, 'winerror', 0)) + ':' + PHASE + '\n'); sys.exit(1)

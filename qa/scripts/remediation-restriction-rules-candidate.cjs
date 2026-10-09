const fs = require('node:fs');
// Isolated emulator candidate only. NEVER written to deployable rules files.
const helpers = `
    function restrictionId(value) { return value.matches('[A-Za-z0-9_-]{1,128}'); }
    function restrictionMillis(value) { return value is int && value >= 0 && value <= 253402300799999; }
    function restrictionRoot(user) {
      let root = user.get('rootId', null);
      return root == null || root == '' || root == false || root == 0 ? request.auth.uid : root;
    }
    // Every required property is accessed below; exact map size rejects unknown fields.
    // ACTIVE has15 mandatory fields; REVOKED has18, including all3 revocation fields.
    function restrictionRecordValid(row, rootId) {
      return row is map
        && row.keys().size() == (row.state == 'ACTIVE' ? 15 : 18)
        && row.schemaVersion == 1
        && row.writer == 'PAY0_TRUSTED_RESTRICTION_WRITER@1'
        && row.policyVersion == 'PAY0-CONTAINMENT@1'
        && restrictionId(row.restrictionId)
        && restrictionId(rootId) && row.rootId == rootId
        && restrictionId(request.auth.uid) && row.subjectUid == request.auth.uid
        && row.scope == 'ACCOUNT_OPERATIONS'
        && row.authority == 'HUMAN_SECURITY_ADMIN'
        && restrictionId(row.authorityUid) && row.authorityUid != request.auth.uid
        && restrictionId(row.incidentId)
        && row.reasonCode in ['SECURITY_REVIEW','CREDENTIAL_COMPROMISE_CONFIRMED','SUPPORT_CONTAINMENT']
        && row.authorizationVersion is int && row.authorizationVersion >= 1 && row.authorizationVersion <= 9007199254740991
        && restrictionMillis(row.issuedAtMs) && restrictionMillis(row.expiresAtMs)
        && row.issuedAtMs <= request.time.toMillis() && row.expiresAtMs > row.issuedAtMs
        && row.expiresAtMs - row.issuedAtMs <= 86400000;
    }
    function restrictionAllowsRecord(row, rootId) {
      return restrictionRecordValid(row, rootId) && (
        (row.state == 'ACTIVE' && row.expiresAtMs <= request.time.toMillis())
        || (row.state == 'REVOKED' && restrictionMillis(row.revokedAtMs)
          && row.revokedAtMs >= row.issuedAtMs && row.revokedAtMs <= request.time.toMillis()
          && restrictionId(row.revokedBy) && row.revokedBy != request.auth.uid
          && row.revocationReason in ['REVIEW_CLEARED','CREDENTIALS_RECOVERED','SUPPORT_RECOVERY'])
      );
    }
    function restrictionAllowsUser(user) {
      return !user.keys().hasAny(['trustedRestrictionV1']) || restrictionAllowsRecord(user.trustedRestrictionV1, restrictionRoot(user));
    }
    function userLifecycleActive(user) {
      return user.get('isDeleted', false) != true && user.get('deleted', false) != true
        && user.get('disabled', false) != true && user.get('deletedAt', null) == null
        && user.get('isActive', true) != false && user.get('active', true) != false;
    }
`;
function replaceOne(source, before, after) {
 if(source.split(before).length!==2) throw Error('Candidate anchor count mismatch: '+before.slice(0,70));
 return source.replace(before,after);
}
exports.candidateRules = (inputs = {}) => {
 let firestore=(inputs.firestore ?? fs.readFileSync('firestore.rules','utf8')).replace(/\r\n/g,'\n');
 let storage=(inputs.storage ?? fs.readFileSync('storage.rules','utf8')).replace(/\r\n/g,'\n');
 firestore=replaceOne(firestore,'    function authenticated()',helpers+'\n    function authenticated()');
 firestore=replaceOne(firestore,'    function authenticated()',`    function accountAllowed() { return authenticated() && restrictionAllowsUser(userDoc(me())); }
    function authenticated()`);
 // One full schema evaluation per allow, rather than nested signedIn re-evaluation.
 firestore=firestore.replace(/(allow\s+[a-z, ]+:\s*if\s*)([^;]+);/g,(all,start,condition)=>condition.trim()==='false'?all:start+'accountAllowed() && ('+condition+');');
 firestore=replaceOne(firestore,`          && roleDefaultAllows(moduleKey, actionKey)
          && individualAllows(moduleKey, actionKey)`,`          && (actionKey == "view" || (roleDefaultAllows(moduleKey, actionKey)
            && individualAllows(moduleKey, actionKey)))`);
 // Equivalent role predicates avoid repeated myRole normalization in the generated policy.
 firestore=replaceOne(firestore,'function isSuperadmin() { return myRole() == "superadmin"; }','function isSuperadmin() { return userDoc(me()).get("role", "") == "superadmin"; }');
 firestore=replaceOne(firestore,'function isAdmin() { return myRole() == "admin"; }','function isAdmin() { return userDoc(me()).get("role", "") == "admin"; }');
 firestore=replaceOne(firestore,'function isOperador() { return myRole() == "operador"; }','function isOperador() { return userDoc(me()).get("role", "") in ["operator", "operador"]; }');
 // Eliminate the duplicate grant lookup without changing delegation predicates.
 const delegationStart=firestore.indexOf('    function clientDelegationIsCurrent(clientId) {');
 const delegationEnd=firestore.indexOf('    function hasClientBasicAccess(clientId) {',delegationStart);
 if(delegationStart<0||delegationEnd<0)throw Error('Missing delegation candidate block');
 let delegation=firestore.slice(delegationStart,delegationEnd);
 delegation=delegation.slice(0,delegation.indexOf('    function clientDelegationPermission('));
 delegation=replaceOne(delegation,'function clientDelegationIsCurrent(clientId)','function clientDelegationPermission(clientId, permission, legacy)');
 delegation=replaceOne(delegation,'      let rootId = myRootId();','      let permissions = access.get("permissions", {});\n      let rootId = myRootId();');
 delegation=replaceOne(delegation,'        && validDelegationTime(access.get("startsAt", null), false);','        && validDelegationTime(access.get("startsAt", null), false)\n        && permissions is map\n        && permissions.get(permission, permissions.get(legacy, true)) == true;');
 firestore=firestore.slice(0,delegationStart)+delegation+firestore.slice(delegationEnd);
 firestore=replaceOne(firestore,'    function hasModuleAction(moduleKey, actionKey) {',`    function individualAllowsViewAndAction(moduleKey, actionKey) {
      let access = userDoc(me()).get("modules", {}).get(moduleKey, {});
      return access.get("view", true) == true && (actionKey == "view" || access.get(actionKey, true) == true);
    }
    function hasModuleAction(moduleKey, actionKey) {`);
 firestore=replaceOne(firestore,`          && individualAllows(moduleKey, "view")
          && (actionKey == "view" || (roleDefaultAllows(moduleKey, actionKey)
            && individualAllows(moduleKey, actionKey)))`,`          && (actionKey == "view" || roleDefaultAllows(moduleKey, actionKey))
          && individualAllowsViewAndAction(moduleKey, actionKey)`);
 firestore=replaceOne(firestore,'    match /users/{uid} {\n      allow read: if accountAllowed() && (canReadUser(uid));','    match /users/{uid} {\n      // Preserve own active profile bootstrap; no lists, writes or economic collections.\n      allow get: if authenticated() && me() == uid && userLifecycleActive(resource.data);\n      allow read: if accountAllowed() && (canReadUser(uid));');
 storage=replaceOne(storage,'    function signedIn()',helpers+`\n    function currentUserAllowed(rootId) {
      let user = userDoc();
      return signedIn() && userLifecycleActive(user) && restrictionRoot(user) == rootId && restrictionAllowsUser(user);
    }

    function signedIn()`);
 for(const family of ['solicitud','pago','dispersion']){
 storage=replaceOne(storage,`          request.auth.uid == rootId
          || ownsDocument(data)
          || ${family}AccessFromData(data)`,`          (request.auth.uid == rootId || ownsDocument(data))
            ? currentUserAllowed(rootId)
            : ${family}AccessFromData(data)`);
 }
 for(const [before,after] of [
 ['      return myRootId() == rootId\n        && funding.sourceClientId','      return currentUserAllowed(rootId)\n        && myRootId() == rootId\n        && funding.sourceClientId'],
 ['      return hasPreparedUploadId()','      return currentUserAllowed(rootId) && hasPreparedUploadId()'],
 ['      return hasPreparedEntityDocumentId()','      return currentUserAllowed(rootId) && hasPreparedEntityDocumentId()'],
 ['      return signedIn()\n        && isSuperAdmin()','      return currentUserAllowed(rootId)\n        && isSuperAdmin()'],
 ['allow read: if signedIn() && request.auth.uid == rootId;','allow read: if currentUserAllowed(rootId) && request.auth.uid == rootId;'],
 ['allow read: if signedIn() && request.auth.uid == ownerUid;','allow read: if currentUserAllowed(rootId) && request.auth.uid == ownerUid;'],
 ['                    && request.auth.uid == ownerUid','                    && currentUserAllowed(rootId)\n                    && request.auth.uid == ownerUid'],
 ['allow read: if signedIn() && isSuperAdmin() && myRootId() == rootId;','allow read: if currentUserAllowed(rootId) && isSuperAdmin() && myRootId() == rootId;'],
 ['      return isSuperAdmin()\n        && myRootId()','      return currentUserAllowed(rootId) && isSuperAdmin()\n        && myRootId()'],
 ])storage=replaceOne(storage,before,after);
 return {firestore,storage};
};

'use strict';

function toArray(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') return [v];
    return v ? [v] : [];
}

function extractSubjectDN(diagCert) {
    var subjectDNs = toArray(diagCert.SubjectDistinguishedName || diagCert.subjectDistinguishedName || []);
    var parsed = {};
    subjectDNs.forEach(function (dn) {
        var val = typeof dn === 'object' ? (dn.value || dn.Value || '') : String(dn);
        if (!val) return;
        val.split(',').forEach(function (part) {
            var kv = part.trim().split('=');
            if (kv.length >= 2) {
                var key = kv[0].trim().toUpperCase();
                var value = kv.slice(1).join('=').trim();
                if (!parsed[key]) parsed[key] = value;
            }
        });
        if (!parsed._raw) parsed._raw = val;
    });
    return parsed;
}

function findSignerCerts(simple, diag) {
    var sigs = simple.signatureOrTimestampOrEvidenceRecord || simple.signatureOrTimestamp || simple.signatures || [];
    var rawArray = Array.isArray(sigs) ? sigs : (sigs ? [sigs] : []);
    var sigArray = rawArray.map(function (item) {
        if (item && item.Signature) return Object.assign({}, item.Signature, { _type: 'signature' });
        if (item && item.Timestamp) return Object.assign({}, item.Timestamp, { _type: 'timestamp' });
        return item;
    }).filter(Boolean);

    var usedCerts = [];
    if (diag) {
        var uc = toArray(diag.UsedCertificates || diag.usedCertificates || diag.Certificate || []);
        uc.forEach(function (c) {
            toArray(c.Certificate || c.certificate || c).forEach(function (item) { usedCerts.push(item); });
        });
        if (!usedCerts.length) usedCerts = uc.slice();
    }

    var results = [];
    sigArray.forEach(function (sig) {
        if (sig._type === 'timestamp') return;
        var chain = sig.CertificateChain || sig.certificateChain;
        if (!chain) return;
        var certs = toArray(chain.Certificate || chain.certificate || chain);
        if (!certs.length) return;
        var signerChainCert = certs[0];
        var certId = signerChainCert.Id || signerChainCert.id || '';
        var diagCert = usedCerts.find(function (c) { return (c.Id || c.id) === certId; });
        results.push({
            signedBy: sig.SignedBy || sig.signedBy || '',
            indication: sig.Indication || sig.indication || '',
            subIndication: sig.SubIndication || sig.subIndication || '',
            signatureFormat: sig.SignatureFormat || sig.signatureFormat || '',
            signingTime: sig.SigningTime || sig.signingTime || '',
            dn: diagCert ? extractSubjectDN(diagCert) : {}
        });
    });
    return results;
}

function normalizeForMatch(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function fuzzyMatch(expected, actual) {
    if (!expected) return 'skip';
    if (!actual) return 'fail';
    var e = normalizeForMatch(expected);
    var a = normalizeForMatch(actual);
    if (a === e) return 'ok';
    if (a.includes(e) || e.includes(a)) return 'ok';
    return 'fail';
}

function performMatch(input, signerInfo) {
    var dn = signerInfo.dn;
    var rows = [];

    if (input.type === 'org') {
        var orgName = dn['O'] || dn['2.5.4.10'] || '';
        rows.push({ field: 'organization', label: 'Organisation', expected: input.name, found: orgName || signerInfo.signedBy, status: fuzzyMatch(input.name, orgName || signerInfo.signedBy) });
        if (input.country) {
            rows.push({ field: 'country', label: 'Land', expected: input.country, found: dn['C'] || '', status: fuzzyMatch(input.country, dn['C']) });
        }
        if (input.orgId) {
            var foundId = dn['2.5.4.97'] || dn['ORGANIZATIONIDENTIFIER'] || dn['SERIALNUMBER'] || dn['OID.2.5.4.97'] || '';
            rows.push({ field: 'orgId', label: 'Organisations-ID', expected: input.orgId, found: foundId, status: fuzzyMatch(input.orgId, foundId) });
        }
    } else {
        var givenName = dn['GIVENNAME'] || dn['G'] || dn['2.5.4.42'] || '';
        var surname = dn['SURNAME'] || dn['SN'] || dn['2.5.4.4'] || '';
        var cn = dn['CN'] || '';
        rows.push({ field: 'givenName', label: 'Vorname', expected: input.givenName, found: givenName || '', status: givenName ? fuzzyMatch(input.givenName, givenName) : fuzzyMatch(input.givenName, cn) });
        rows.push({ field: 'surname', label: 'Nachname', expected: input.surname, found: surname || '', status: surname ? fuzzyMatch(input.surname, surname) : fuzzyMatch(input.surname, cn) });
        if (input.country) {
            rows.push({ field: 'country', label: 'Land', expected: input.country, found: dn['C'] || '', status: fuzzyMatch(input.country, dn['C']) });
        }
        if (input.serialNumber) {
            var sn = dn['SERIALNUMBER'] || dn['2.5.4.5'] || '';
            rows.push({ field: 'serialNumber', label: 'Seriennummer', expected: input.serialNumber, found: sn, status: fuzzyMatch(input.serialNumber, sn) });
        }
    }

    var checkedRows = rows.filter(function (r) { return r.status !== 'skip'; });
    var okCount = checkedRows.filter(function (r) { return r.status === 'ok'; }).length;
    var failCount = checkedRows.filter(function (r) { return r.status === 'fail'; }).length;

    var overall;
    if (failCount === 0 && okCount > 0) overall = 'match';
    else if (okCount > 0 && failCount > 0) overall = 'partial';
    else overall = 'no_match';

    return { overall: overall, matchedFields: okCount, failedFields: failCount, totalChecked: checkedRows.length, fields: rows };
}

function buildMatchResponse(dssData, registrationInput) {
    var simple = dssData.SimpleReport || dssData.simpleReport || dssData.simpleReportJaxb || dssData;
    var diag = dssData.DiagnosticData || dssData.diagnosticData || dssData.diagnosticDataJaxb || null;

    var signers = findSignerCerts(simple, diag);
    if (!signers.length) {
        return {
            overall: 'no_signatures',
            message: 'Das Dokument enthält keine Signaturen oder Siegel zum Abgleich.',
            signatures: []
        };
    }

    var results = signers.map(function (signer) {
        var matchResult = performMatch(registrationInput, signer);
        return {
            signedBy: signer.signedBy,
            indication: signer.indication,
            subIndication: signer.subIndication,
            signatureFormat: signer.signatureFormat,
            signingTime: signer.signingTime,
            certificateSubject: signer.dn._raw || '',
            match: matchResult
        };
    });

    var allMatch = results.every(function (r) { return r.match.overall === 'match'; });
    var anyMatch = results.some(function (r) { return r.match.overall === 'match'; });

    return {
        overall: allMatch ? 'match' : (anyMatch ? 'partial' : 'no_match'),
        message: allMatch ? 'Alle Signaturen stimmen mit den Registrierungsdaten überein.' :
            (anyMatch ? 'Einige Signaturen stimmen mit den Registrierungsdaten überein.' :
                'Keine Signatur stimmt mit den Registrierungsdaten überein.'),
        registrationType: registrationInput.type,
        signatures: results
    };
}

module.exports = { buildMatchResponse, performMatch, findSignerCerts, extractSubjectDN };

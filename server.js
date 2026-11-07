'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const openApiSpec = require('./api/openapi.json');
const { buildMatchResponse, findSignerCerts, extractSubjectDN } = require('./api/match-logic');

const app = express();
const PORT = process.env.PORT || 3000;
const SVA_API_URL = process.env.SVA_API_URL || 'https://api.uat.sign8.eu/sva/v1/validation/document/raw';

app.use(cors());
app.use(express.json({ limit: '15mb' }));

app.use(express.static(path.join(__dirname), {
    index: 'index.html',
    extensions: ['html']
}));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    customCss: '.swagger-ui .topbar { background-color: #1E6568; }',
    customSiteTitle: 'SIGN8 Signature-DSS-Validation API'
}));

app.get('/api/v1/openapi.json', function (req, res) {
    var spec = JSON.parse(JSON.stringify(openApiSpec));
    spec.servers = [{ url: req.protocol + '://' + req.get('host'), description: 'Aktueller Server' }];
    res.json(spec);
});

async function callSvaApi(document) {
    var resp = await fetch(SVA_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: document })
    });
    if (!resp.ok) {
        var body;
        try { body = await resp.json(); } catch (e) { body = {}; }
        var err = new Error(body.message || body.error || 'SVA API returned HTTP ' + resp.status);
        err.statusCode = resp.status >= 500 ? 502 : resp.status;
        throw err;
    }
    return resp.json();
}

function buildValidationSummary(dssData) {
    var simple = dssData.SimpleReport || dssData.simpleReport || dssData.simpleReportJaxb || dssData;
    var diag = dssData.DiagnosticData || dssData.diagnosticData || dssData.diagnosticDataJaxb || null;
    var sigs = simple.signatureOrTimestampOrEvidenceRecord || simple.signatureOrTimestamp || simple.signatures || [];
    var rawArray = Array.isArray(sigs) ? sigs : (sigs ? [sigs] : []);
    var sigArray = rawArray.map(function (item) {
        if (item && item.Signature) return Object.assign({}, item.Signature, { _type: 'signature' });
        if (item && item.Timestamp) return Object.assign({}, item.Timestamp, { _type: 'timestamp' });
        return item;
    }).filter(Boolean);

    var totalSigs = simple.signaturesCount ?? sigArray.length;
    var validSigs = simple.validSignaturesCount ?? 0;

    var status;
    if (totalSigs === 0) status = 'no_signatures';
    else if (validSigs === totalSigs) status = 'valid';
    else if (validSigs === 0) status = 'invalid';
    else status = 'indeterminate';

    var signerCerts = findSignerCerts(simple, diag);

    var signatures = sigArray.map(function (sig, i) {
        var sigLevel = sig.SignatureLevel || sig.signatureLevel || '';
        var signerInfo = signerCerts[i] || {};
        return {
            signedBy: sig.SignedBy || sig.signedBy || '',
            indication: sig.Indication || sig.indication || '',
            subIndication: sig.SubIndication || sig.subIndication || '',
            signatureFormat: sig.SignatureFormat || sig.signatureFormat || '',
            signatureLevel: typeof sigLevel === 'object' ? (sigLevel.value || '') : sigLevel,
            signingTime: sig.SigningTime || sig.signingTime || '',
            certificateSubject: (signerInfo.dn && signerInfo.dn._raw) || ''
        };
    });

    return {
        status: status,
        signaturesCount: totalSigs,
        validSignaturesCount: validSigs,
        signatures: signatures
    };
}

// ── POST /api/v1/validate ───────────────────────────────

app.post('/api/v1/validate', async function (req, res) {
    try {
        if (!req.body.document) {
            return res.status(400).json({ error: 'Feld "document" (Base64-kodiertes PDF) ist erforderlich.', code: 'MISSING_DOCUMENT' });
        }
        var dssData = await callSvaApi(req.body.document);
        res.json(dssData);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message, code: 'VALIDATION_ERROR' });
    }
});

// ── POST /api/v1/validate/summary ───────────────────────

app.post('/api/v1/validate/summary', async function (req, res) {
    try {
        if (!req.body.document) {
            return res.status(400).json({ error: 'Feld "document" (Base64-kodiertes PDF) ist erforderlich.', code: 'MISSING_DOCUMENT' });
        }
        var dssData = await callSvaApi(req.body.document);
        res.json(buildValidationSummary(dssData));
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message, code: 'VALIDATION_ERROR' });
    }
});

// ── POST /api/v1/match/organization ─────────────────────

app.post('/api/v1/match/organization', async function (req, res) {
    try {
        if (!req.body.document) {
            return res.status(400).json({ error: 'Feld "document" (Base64-kodiertes PDF) ist erforderlich.', code: 'MISSING_DOCUMENT' });
        }
        if (!req.body.organization || !req.body.organization.name) {
            return res.status(400).json({ error: 'Feld "organization.name" ist erforderlich.', code: 'MISSING_ORG_NAME' });
        }

        var dssData = await callSvaApi(req.body.document);
        var matchInput = {
            type: 'org',
            name: req.body.organization.name,
            country: (req.body.organization.country || '').toUpperCase(),
            orgId: req.body.organization.organizationId || ''
        };
        var matchResult = buildMatchResponse(dssData, matchInput);
        matchResult.validation = buildValidationSummary(dssData);
        res.json(matchResult);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message, code: 'MATCH_ERROR' });
    }
});

// ── POST /api/v1/match/person ───────────────────────────

app.post('/api/v1/match/person', async function (req, res) {
    try {
        if (!req.body.document) {
            return res.status(400).json({ error: 'Feld "document" (Base64-kodiertes PDF) ist erforderlich.', code: 'MISSING_DOCUMENT' });
        }
        if (!req.body.person || (!req.body.person.givenName && !req.body.person.surname)) {
            return res.status(400).json({ error: 'Felder "person.givenName" und/oder "person.surname" sind erforderlich.', code: 'MISSING_PERSON_DATA' });
        }

        var dssData = await callSvaApi(req.body.document);
        var matchInput = {
            type: 'person',
            givenName: req.body.person.givenName || '',
            surname: req.body.person.surname || '',
            country: (req.body.person.country || '').toUpperCase(),
            serialNumber: req.body.person.serialNumber || ''
        };
        var matchResult = buildMatchResponse(dssData, matchInput);
        matchResult.validation = buildValidationSummary(dssData);
        res.json(matchResult);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message, code: 'MATCH_ERROR' });
    }
});

// ── GET /api/v1/health ──────────────────────────────────

app.get('/api/v1/health', async function (req, res) {
    var svaStatus = 'unknown';
    try {
        var resp = await fetch(SVA_API_URL.replace('/document/raw', ''), { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        svaStatus = resp.ok || resp.status === 405 ? 'reachable' : 'error (' + resp.status + ')';
    } catch (e) {
        svaStatus = 'unreachable';
    }
    res.json({ status: 'ok', version: '1.0.0', svaApi: svaStatus, timestamp: new Date().toISOString() });
});

app.listen(PORT, function () {
    console.log('SIGN8 Signature-DSS-Validation API running on port ' + PORT);
    console.log('  Frontend:  http://localhost:' + PORT + '/');
    console.log('  API Docs:  http://localhost:' + PORT + '/api-docs');
    console.log('  OpenAPI:   http://localhost:' + PORT + '/api/v1/openapi.json');
    console.log('  Health:    http://localhost:' + PORT + '/api/v1/health');
});

module.exports = app;

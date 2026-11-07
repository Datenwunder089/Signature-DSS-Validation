/**
 * DSS Signature Validator
 * Uses SIGN8 SVA /raw API for EU DSS-compliant document validation
 * Supports full SimpleReport, DetailedReport and DiagnosticData parsing
 */

(function () {
    'use strict';

    const SVA_API_URL = 'https://api.uat.sign8.eu/sva/v1/validation/document/raw';
    const CORS_PROXY = 'https://corsproxy.io/?url=';
    const LOCAL_API = '/api/v1/validate';
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    var useLocalApi = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // DOM
    const $ = id => document.getElementById(id);
    const uploadCard = $('uploadCard');
    const uploadZone = $('uploadZone');
    const fileInput = $('fileInput');
    const selectFileBtn = $('selectFileBtn');
    const fileSelected = $('fileSelected');
    const fileNameEl = $('fileName');
    const fileSizeEl = $('fileSize');
    const removeFile = $('removeFile');
    const validateBtn = $('validateBtn');
    const loadingCard = $('loadingCard');
    const resultsCard = $('resultsCard');
    const docName = $('docName');
    const docMeta = $('docMeta');
    const overallStatus = $('overallStatus');
    const signaturesList = $('signaturesList');
    const rawJson = $('rawJson');
    const newValidation = $('newValidation');
    const errorCard = $('errorCard');
    const errorMessage = $('errorMessage');
    const retryBtn = $('retryBtn');

    let selectedFile = null;
    let matchMode = false;

    // ── Mode Tabs ────────────────────────────────────────────

    var modeTabs = document.getElementById('modeTabs');
    var matchPanel = document.getElementById('matchPanel');
    var matchFieldsOrg = document.getElementById('matchFieldsOrg');
    var matchFieldsPerson = document.getElementById('matchFieldsPerson');
    var matchTypeOrg = document.getElementById('matchTypeOrg');
    var matchTypePerson = document.getElementById('matchTypePerson');

    modeTabs.querySelectorAll('.mode-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
            modeTabs.querySelectorAll('.mode-tab').forEach(function(t) { t.classList.remove('active'); });
            tab.classList.add('active');
            matchMode = tab.dataset.mode === 'match';
            if (matchMode) { matchPanel.classList.remove('hidden'); }
            else { matchPanel.classList.add('hidden'); }
        });
    });

    matchTypeOrg.addEventListener('click', function() {
        matchTypeOrg.classList.add('active'); matchTypePerson.classList.remove('active');
        matchFieldsOrg.classList.remove('hidden'); matchFieldsPerson.classList.add('hidden');
    });
    matchTypePerson.addEventListener('click', function() {
        matchTypePerson.classList.add('active'); matchTypeOrg.classList.remove('active');
        matchFieldsPerson.classList.remove('hidden'); matchFieldsOrg.classList.add('hidden');
    });

    // ── File Upload ──────────────────────────────────────────

    selectFileBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => { if (e.target.files.length) handleFile(e.target.files[0]); });

    uploadZone.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); uploadZone.classList.add('drag-over'); });
    uploadZone.addEventListener('dragleave', e => { e.preventDefault(); e.stopPropagation(); uploadZone.classList.remove('drag-over'); });
    uploadZone.addEventListener('drop', e => {
        e.preventDefault(); e.stopPropagation(); uploadZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    document.body.addEventListener('dragover', e => e.preventDefault());
    document.body.addEventListener('drop', e => e.preventDefault());

    function handleFile(file) {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))
            return showError('Bitte laden Sie eine PDF-Datei hoch.');
        if (file.size > MAX_FILE_SIZE)
            return showError('Die Datei ist zu groß. Maximale Dateigröße: 10 MB.');
        selectedFile = file;
        fileNameEl.textContent = selectedFile.name;
        fileSizeEl.textContent = fmtSize(selectedFile.size);
        uploadZone.classList.add('hidden');
        fileSelected.classList.remove('hidden');
    }

    removeFile.addEventListener('click', resetUpload);

    function resetUpload() {
        selectedFile = null; fileInput.value = '';
        uploadZone.classList.remove('hidden'); fileSelected.classList.add('hidden');
        selectFileBtn.focus();
    }

    // ── Validation ───────────────────────────────────────────

    validateBtn.addEventListener('click', () => { if (selectedFile) startValidation(); });

    async function startValidation() {
        show(loadingCard); hide(uploadCard, resultsCard, errorCard);
        try {
            const base64 = await fileToBase64(selectedFile);
            const apiUrl = useLocalApi ? LOCAL_API : CORS_PROXY + encodeURIComponent(SVA_API_URL);
            const resp = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ document: base64 })
            });
            if (!resp.ok) {
                let msg = 'HTTP ' + resp.status;
                try { const b = await resp.json(); msg = b.message || b.error || msg; } catch {}
                throw new Error(msg);
            }
            const data = await resp.json();
            renderResults(data);
        } catch (err) {
            console.error('Validation error:', err);
            showError(err.message || 'Ein unbekannter Fehler ist aufgetreten.');
        }
    }

    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result.split(',')[1]);
            r.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
            r.readAsDataURL(file);
        });
    }

    // ── Results Rendering ────────────────────────────────────

    function renderResults(data) {
        hide(loadingCard); show(resultsCard);
        docName.textContent = selectedFile.name;
        docMeta.textContent = fmtSize(selectedFile.size);
        rawJson.textContent = JSON.stringify(data, null, 2);

        const simple = data.SimpleReport || data.simpleReport || data.simpleReportJaxb || data;
        const detailed = data.DetailedReport || data.detailedReport || data.detailedReportJaxb || null;
        const diag = data.DiagnosticData || data.diagnosticData || data.diagnosticDataJaxb || null;

        renderOverview(simple, detailed, diag);

        if (matchMode) {
            renderMatchResult(simple, diag);
        }

        // the focused "Jetzt validieren" button is gone – move focus to the result heading
        var title = resultsCard.querySelector('.results-title');
        if (title) title.focus();
    }

    function renderOverview(simple, detailed, diag) {
        const policy = simple.validationPolicy || simple.ValidationPolicy || simple.Policy || null;
        const sigs = simple.signatureOrTimestampOrEvidenceRecord || simple.signatureOrTimestamp || simple.signatures || simple.Signature || [];
        const rawArray = Array.isArray(sigs) ? sigs : (sigs ? [sigs] : []);
        // DSS wraps items in {Signature:...} or {Timestamp:...} or {EvidenceRecord:...}
        const sigArray = rawArray.map(function(item) {
            if (item && item.Signature) return Object.assign({}, item.Signature, { _type: 'signature' });
            if (item && item.Timestamp) return Object.assign({}, item.Timestamp, { _type: 'timestamp' });
            if (item && item.EvidenceRecord) return Object.assign({}, item.EvidenceRecord, { _type: 'evidenceRecord' });
            return item;
        }).filter(Boolean);

        const totalSigs = simple.signaturesCount ?? simple.SignaturesCount ?? sigArray.length;
        const validSigs = simple.validSignaturesCount ?? simple.ValidSignaturesCount ?? 0;
        const invalidSigs = totalSigs - validSigs;

        const overall = determineOverall(sigArray, totalSigs, validSigs);
        renderOverallBanner(overall);
        renderChainWarning(sigArray, simple);

        const countsHtml = '<div class="summary-counts">' +
            '<div class="count-item"><span class="count-number">' + totalSigs + '</span><span class="count-label">Signaturen</span></div>' +
            '<div class="count-item count-valid"><span class="count-number">' + validSigs + '</span><span class="count-label">Gültig</span></div>' +
            '<div class="count-item count-invalid"><span class="count-number">' + invalidSigs + '</span><span class="count-label">Ungültig</span></div></div>';

        let policyHtml = '';
        if (policy) {
            const pName = policy.policyName || policy.PolicyName || '';
            const pDesc = policy.policyDescription || policy.PolicyDescription || '';
            if (pName) {
                policyHtml = '<div class="validation-policy"><span class="policy-label">Validierungsrichtlinie</span>' +
                    '<span class="policy-name">' + esc(pName) + '</span>' +
                    (pDesc ? '<span class="policy-desc">' + esc(pDesc) + '</span>' : '') + '</div>';
            }
        }

        signaturesList.innerHTML = countsHtml + policyHtml;

        sigArray.forEach(function(sig, i) {
            var isTimestamp = sig._type === 'timestamp' || !!(sig.productionTime || sig.ProductionTime || sig.TimestampLevel || sig.timestampLevel);
            signaturesList.appendChild(
                isTimestamp ? renderTimestampCard(sig, i, detailed, diag) : renderSignatureCard(sig, i, detailed, diag)
            );
        });
    }

    // ── Overall Banner ───────────────────────────────────────

    function determineOverall(sigs, total, valid) {
        if (total === 0) return { status: 'info', label: 'Keine Signaturen gefunden', desc: 'Das Dokument enthält keine digitalen Signaturen oder Siegel.' };
        if (valid === total) return { status: 'valid', label: 'Alle Signaturen gültig', desc: valid + ' von ' + total + ' Signatur(en) erfolgreich validiert.' };
        var hasIndeterminate = sigs.some(function(s) { return indicationClass(s) === 'indeterminate'; });
        if (valid === 0 && !hasIndeterminate) return { status: 'invalid', label: 'Signaturen ungültig', desc: 'Keine der ' + total + ' Signatur(en) konnte validiert werden.' };
        return { status: 'warning', label: 'Eingeschränkt gültig', desc: valid + ' von ' + total + ' Signatur(en) gültig. Einige konnten nicht vollständig validiert werden.' };
    }

    var ICONS = {
        valid: '<svg class="status-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M8 12L11 15L16 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        invalid: '<svg class="status-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M8 8L16 16M16 8L8 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        warning: '<svg class="status-icon" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 22H22L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10V14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="18" r="1" fill="currentColor"/></svg>',
        info: '<svg class="status-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 8V12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>'
    };

    function renderOverallBanner(o) {
        overallStatus.className = 'overall-status status-' + o.status;
        overallStatus.innerHTML = ICONS[o.status] +
            '<div class="status-body"><strong class="status-label">' + esc(o.label) + '</strong>' +
            (o.desc ? '<div class="status-desc">' + esc(o.desc) + '</div>' : '') + '</div>';
    }

    // ── Signature Card (Level 1 → 2 → 3) ────────────────────

    function renderSignatureCard(sig, index, detailed, diag) {
        var status = indicationClass(sig);
        var indication = sig.Indication || sig.indication || '';
        var subIndication = sig.SubIndication || sig.subIndication || '';
        var signedBy = sig.SignedBy || sig.signedBy || 'Signatur ' + (index + 1);
        var signingTime = sig.SigningTime || sig.signingTime || '';
        var bestSigTime = sig.BestSignatureTime || sig.bestSignatureTime || '';
        var sigFormat = sig.SignatureFormat || sig.signatureFormat || '';
        var sigLevel = sig.SignatureLevel || sig.signatureLevel || '';
        var sigLevelStr = typeof sigLevel === 'object' ? (sigLevel.value || sigLevel.description || JSON.stringify(sigLevel)) : sigLevel;
        var sigId = sig.Id || sig.id || '';
        var certChain = sig.CertificateChain || sig.certificateChain || null;
        var scopes = sig.SignatureScope || sig.signatureScope || [];
        var scopeArray = Array.isArray(scopes) ? scopes : [scopes];
        var adesDetails = sig.AdESValidationDetails || sig.adESValidationDetails || sig.adESValidationMessages || null;
        var qualDetails = sig.QualificationDetails || sig.qualificationDetails || null;
        var timestamps = sig.Timestamps || sig.timestamps || null;

        var card = el('div', 'signature-item');
        card.innerHTML =
            '<div class="signature-header" data-toggle="sig-detail-' + index + '" role="button" tabindex="0" aria-expanded="false" aria-controls="sig-detail-' + index + '">' +
                '<div class="sig-status-badge ' + status + '">' + statusLabel(status) + '</div>' +
                '<div class="sig-info">' +
                    '<span class="sig-name">' + esc(signedBy) + '</span>' +
                    '<span class="sig-meta">' + (sigFormat ? esc(sigFormat) : '') + (signingTime ? ' &middot; ' + esc(fmtDate(signingTime)) : '') + '</span>' +
                '</div>' +
                '<svg class="sig-expand" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</div>' +
            '<div class="signature-details" id="sig-detail-' + index + '">' +
                '<div class="detail-grid">' +
                    '<div class="detail-item"><span class="detail-label">Status</span><span class="detail-value dss-indication ' + status + '">' + esc(indication) + '</span></div>' +
                    (subIndication ? '<div class="detail-item"><span class="detail-label">Sub-Indication</span><span class="detail-value">' + esc(subIndication) + '</span></div>' : '') +
                    '<div class="detail-item"><span class="detail-label">Unterzeichner</span><span class="detail-value">' + esc(signedBy) + '</span></div>' +
                    (sigFormat ? '<div class="detail-item"><span class="detail-label">Signaturformat</span><span class="detail-value">' + esc(sigFormat) + '</span></div>' : '') +
                    (sigLevelStr ? '<div class="detail-item"><span class="detail-label">Signaturlevel</span><span class="detail-value">' + esc(sigLevelStr) + '</span></div>' : '') +
                    (signingTime ? '<div class="detail-item"><span class="detail-label">Signaturzeitpunkt</span><span class="detail-value">' + esc(fmtDate(signingTime)) + '</span></div>' : '') +
                    (bestSigTime ? '<div class="detail-item"><span class="detail-label">Bester Signaturzeitpunkt</span><span class="detail-value">' + esc(fmtDate(bestSigTime)) + '</span></div>' : '') +
                    (sigId ? '<div class="detail-item full-width"><span class="detail-label">Signatur-ID</span><span class="detail-value detail-mono detail-muted">' + esc(sigId) + '</span></div>' : '') +
                '</div>' +
                renderAccordionSection('Validierungs-Details', renderValidationMessages(adesDetails), index + '-ades') +
                renderAccordionSection('Qualifizierungs-Details', renderValidationMessages(qualDetails), index + '-qual') +
                renderAccordionSection('Zertifikatskette', renderCertChain(certChain, diag), index + '-chain') +
                renderAccordionSection('Signatur-Umfang', renderScopes(scopeArray), index + '-scope') +
                renderAccordionSection('Zeitstempel', renderTimestampsNested(timestamps, detailed, diag), index + '-ts') +
                renderAccordionSection('Erweiterte Zertifikats-Details', renderCertDiagDetails(certChain, diag), index + '-certdiag') +
            '</div>';

        card.querySelector('.signature-header').addEventListener('click', function() {
            var det = card.querySelector('.signature-details');
            det.classList.toggle('open');
            card.querySelector('.sig-expand').classList.toggle('expanded');
            this.setAttribute('aria-expanded', String(det.classList.contains('open')));
        });

        card.querySelectorAll('.accordion-trigger').forEach(function(trigger) {
            trigger.addEventListener('click', function(e) {
                e.stopPropagation();
                var target = card.querySelector('#' + trigger.dataset.target);
                if (target) { target.classList.toggle('open'); trigger.classList.toggle('open'); }
                trigger.setAttribute('aria-expanded', String(trigger.classList.contains('open')));
            });
        });

        return card;
    }

    // ── Timestamp Card ───────────────────────────────────────

    function renderTimestampCard(sig, index, detailed, diag) {
        var status = indicationClass(sig);
        var indication = sig.Indication || sig.indication || '';
        var subIndication = sig.SubIndication || sig.subIndication || '';
        var producedBy = sig.ProducedBy || sig.producedBy || 'Zeitstempel';
        var productionTime = sig.ProductionTime || sig.productionTime || '';
        var tsLevel = sig.TimestampLevel || sig.timestampLevel || '';
        var certChain = sig.CertificateChain || sig.certificateChain || null;

        var card = el('div', 'signature-item timestamp-item');
        card.innerHTML =
            '<div class="signature-header" role="button" tabindex="0" aria-expanded="false">' +
                '<div class="sig-status-badge ' + status + '">' + statusLabel(status) + '</div>' +
                '<div class="sig-info">' +
                    '<span class="sig-name">' + esc(producedBy) + '</span>' +
                    '<span class="sig-meta">Zeitstempel' + (productionTime ? ' &middot; ' + esc(fmtDate(productionTime)) : '') + '</span>' +
                '</div>' +
                '<svg class="sig-expand" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</div>' +
            '<div class="signature-details">' +
                '<div class="detail-grid">' +
                    '<div class="detail-item"><span class="detail-label">Status</span><span class="detail-value dss-indication ' + status + '">' + esc(indication) + '</span></div>' +
                    (subIndication ? '<div class="detail-item"><span class="detail-label">Sub-Indication</span><span class="detail-value">' + esc(subIndication) + '</span></div>' : '') +
                    (productionTime ? '<div class="detail-item"><span class="detail-label">Erzeugungszeitpunkt</span><span class="detail-value">' + esc(fmtDate(productionTime)) + '</span></div>' : '') +
                    (tsLevel ? '<div class="detail-item"><span class="detail-label">Zeitstempel-Level</span><span class="detail-value">' + esc(typeof tsLevel === 'object' ? (tsLevel.value || JSON.stringify(tsLevel)) : tsLevel) + '</span></div>' : '') +
                '</div>' +
                renderAccordionSection('Zertifikatskette', renderCertChain(certChain, diag), 'ts' + index + '-chain') +
                renderAccordionSection('Erweiterte Zertifikats-Details', renderCertDiagDetails(certChain, diag), 'ts' + index + '-certdiag') +
            '</div>';

        card.querySelector('.signature-header').addEventListener('click', function() {
            card.querySelector('.signature-details').classList.toggle('open');
            card.querySelector('.sig-expand').classList.toggle('expanded');
            this.setAttribute('aria-expanded', String(card.querySelector('.signature-details').classList.contains('open')));
        });
        card.querySelectorAll('.accordion-trigger').forEach(function(trigger) {
            trigger.addEventListener('click', function(e) {
                e.stopPropagation();
                var target = card.querySelector('#' + trigger.dataset.target);
                if (target) { target.classList.toggle('open'); trigger.classList.toggle('open'); }
                trigger.setAttribute('aria-expanded', String(trigger.classList.contains('open')));
            });
        });

        return card;
    }

    // ── Accordion Section Builder ────────────────────────────

    function renderAccordionSection(title, content, id) {
        if (!content) return '';
        return '<div class="accordion-section">' +
            '<div class="accordion-trigger" data-target="acc-' + id + '" role="button" tabindex="0" aria-expanded="false" aria-controls="acc-' + id + '">' +
                '<svg class="accordion-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M4 5L7 8L10 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '<span>' + esc(title) + '</span>' +
            '</div>' +
            '<div class="accordion-content" id="acc-' + id + '">' + content + '</div></div>';
    }

    // ── Validation Messages ──────────────────────────────────

    function renderValidationMessages(details) {
        if (!details) return null;
        var errors = toArray(details.Error || details.error || details.errors || []);
        var warnings = toArray(details.Warning || details.warning || details.warnings || []);
        var infos = toArray(details.Info || details.info || details.infos || []);
        if (!errors.length && !warnings.length && !infos.length) return null;

        var html = '<div class="validation-details-section">';
        errors.forEach(function(m) {
            var text = typeof m === 'object' ? (m.value || m.Value || m.message || JSON.stringify(m)) : m;
            html += '<div class="vd-message vd-error"><span class="vd-badge">Fehler</span><span>' + esc(text) + '</span></div>';
        });
        warnings.forEach(function(m) {
            var text = typeof m === 'object' ? (m.value || m.Value || m.message || JSON.stringify(m)) : m;
            html += '<div class="vd-message vd-warning"><span class="vd-badge">Warnung</span><span>' + esc(text) + '</span></div>';
        });
        infos.forEach(function(m) {
            var text = typeof m === 'object' ? (m.value || m.Value || m.message || JSON.stringify(m)) : m;
            html += '<div class="vd-message vd-info"><span class="vd-badge">Info</span><span>' + esc(text) + '</span></div>';
        });
        html += '</div>';
        return html;
    }

    // ── Certificate Chain ────────────────────────────────────

    function renderCertChain(chain, diag) {
        if (!chain) return null;
        var certs = toArray(chain.Certificate || chain.certificate || chain);
        if (!certs.length) return null;

        var html = '<div class="cert-chain-section">';
        certs.forEach(function(cert, i) {
            var name = cert.QualifiedName || cert.qualifiedName || cert.id || cert.Id || 'Zertifikat ' + (i + 1);
            var trusted = cert.trusted === true || cert.Trusted === true;
            var sunsetDate = cert.sunsetDate || cert.SunsetDate || '';
            var anchors = cert.TrustAnchors || cert.trustAnchors || null;
            var anchorArray = anchors ? toArray(anchors.TrustAnchor || anchors.trustAnchor || anchors) : [];

            html += '<div class="cert-item">' +
                '<div class="cert-header">' +
                    '<span class="cert-index">' + (i + 1) + '</span>' +
                    '<span class="cert-name">' + esc(name) + '</span>' +
                    '<span class="trust-badge ' + (trusted ? 'trusted' : 'untrusted') + '">' + (trusted ? 'Vertrauenswürdig' : 'Nicht vertrauenswürdig') + '</span>' +
                '</div>' +
                (sunsetDate ? '<div class="cert-sub">Sunset: ' + esc(fmtDate(sunsetDate)) + '</div>' : '') +
                (anchorArray.length ? renderTrustAnchors(anchorArray) : '') +
            '</div>';
        });
        html += '</div>';
        return html;
    }

    function renderTrustAnchors(anchors) {
        var html = '<div class="trust-anchors">';
        anchors.forEach(function(a) {
            var tsp = a.TrustServiceProvider || a.trustServiceProvider || '';
            var tsName = a.TrustServiceName || a.trustServiceName || '';
            var cc = a.countryCode || a.CountryCode || '';
            html += '<div class="anchor-item">' + (cc ? '<strong>[' + esc(cc) + ']</strong> ' : '') + esc(tsp) + (tsName ? ' &mdash; ' + esc(tsName) : '') + '</div>';
        });
        html += '</div>';
        return html;
    }

    // ── Scopes ───────────────────────────────────────────────

    function renderScopes(scopes) {
        if (!scopes.length || (scopes.length === 1 && !scopes[0])) return null;
        var html = '<div class="scope-section">';
        scopes.forEach(function(s) {
            if (!s) return;
            var name = s.name || s.Name || '';
            var scopeType = s.scope || s.Scope || '';
            var value = s.value || s.Value || s.description || '';
            html += '<div class="scope-item">' +
                (scopeType ? '<span class="scope-type">' + esc(scopeType) + '</span>' : '') +
                (name ? '<span class="scope-name">' + esc(name) + '</span>' : '') +
                (value ? '<span class="scope-value">' + esc(value) + '</span>' : '') +
            '</div>';
        });
        html += '</div>';
        return html;
    }

    // ── Nested Timestamps ────────────────────────────────────

    function renderTimestampsNested(timestamps, detailed, diag) {
        if (!timestamps) return null;
        var tsArray = toArray(timestamps.Timestamp || timestamps.timestamp || timestamps);
        if (!tsArray.length) return null;

        var html = '';
        tsArray.forEach(function(ts, i) {
            var status = indicationClass(ts);
            var indication = ts.Indication || ts.indication || '';
            var productionTime = ts.ProductionTime || ts.productionTime || '';
            var producedBy = ts.ProducedBy || ts.producedBy || 'Zeitstempel ' + (i + 1);
            var tsLevel = ts.TimestampLevel || ts.timestampLevel || '';

            html += '<div class="cert-item ts-nested">' +
                '<div class="cert-header">' +
                    '<span class="sig-status-badge sig-status-badge-sm ' + status + '">' + statusLabel(status) + '</span>' +
                    '<span class="cert-name">' + esc(producedBy) + '</span>' +
                '</div>' +
                '<div class="ts-nested-meta">' +
                    (indication ? 'Status: <strong>' + esc(indication) + '</strong>' : '') +
                    (productionTime ? ' &middot; ' + esc(fmtDate(productionTime)) : '') +
                    (tsLevel ? ' &middot; Level: ' + esc(typeof tsLevel === 'object' ? (tsLevel.value || '') : tsLevel) : '') +
                '</div></div>';
        });
        return html;
    }

    // ── Certificate Details from DiagnosticData ──────────────

    function renderCertDiagDetails(chain, diag) {
        if (!chain || !diag) return null;
        var certs = toArray(chain.Certificate || chain.certificate || chain);
        var usedCerts = toArray(diag.UsedCertificates || diag.usedCertificates || diag.Certificate || []);
        var usedCertItems = [];
        usedCerts.forEach(function(uc) {
            var items = toArray(uc.Certificate || uc.certificate || uc);
            items.forEach(function(item) { usedCertItems.push(item); });
        });
        if (!usedCertItems.length) usedCertItems = usedCerts.slice();

        if (!certs.length || !usedCertItems.length) return null;

        var html = '';
        certs.forEach(function(chainCert, i) {
            var certId = chainCert.Id || chainCert.id || '';
            var diagCert = usedCertItems.find(function(c) { return (c.Id || c.id) === certId; });
            if (!diagCert) return;

            var subject = diagCert.SubjectDistinguishedName || diagCert.subjectDistinguishedName || [];
            var issuerDn = diagCert.IssuerDistinguishedName || diagCert.issuerDistinguishedName || [];
            var serial = diagCert.SerialNumber || diagCert.serialNumber || '';
            var notBefore = diagCert.NotBefore || diagCert.notBefore || '';
            var notAfter = diagCert.NotAfter || diagCert.notAfter || '';
            var keyUsages = diagCert.KeyUsages || diagCert.keyUsages || [];
            var selfSigned = diagCert.SelfSigned || diagCert.selfSigned || false;
            var source = diagCert.CertificateSource || diagCert.certificateSource || '';

            var subjectArr = toArray(subject);
            var issuerArr = toArray(issuerDn);
            var kuArr = toArray(keyUsages.KeyUsage || keyUsages.keyUsage || keyUsages);

            var subjectStr = subjectArr.map(function(s) { return typeof s === 'object' ? (s.value || s.Value || '') : s; }).filter(Boolean).join(', ');
            var issuerStr = issuerArr.map(function(s) { return typeof s === 'object' ? (s.value || s.Value || '') : s; }).filter(Boolean).join(', ');

            html += '<div class="cert-item">' +
                '<div class="cert-header">' +
                    '<span class="cert-index">' + (i + 1) + '</span>' +
                    '<span class="cert-name">' + esc(chainCert.QualifiedName || chainCert.qualifiedName || certId) + '</span>' +
                '</div>' +
                '<div class="detail-grid cert-detail-grid">' +
                    (subjectStr ? '<div class="detail-item full-width"><span class="detail-label">Subject</span><span class="detail-value detail-small">' + esc(subjectStr) + '</span></div>' : '') +
                    (issuerStr ? '<div class="detail-item full-width"><span class="detail-label">Issuer</span><span class="detail-value detail-small">' + esc(issuerStr) + '</span></div>' : '') +
                    (serial ? '<div class="detail-item"><span class="detail-label">Seriennummer</span><span class="detail-value detail-mono">' + esc(String(serial)) + '</span></div>' : '') +
                    (source ? '<div class="detail-item"><span class="detail-label">Quelle</span><span class="detail-value">' + esc(source) + '</span></div>' : '') +
                    (notBefore ? '<div class="detail-item"><span class="detail-label">Gültig ab</span><span class="detail-value">' + esc(fmtDate(notBefore)) + '</span></div>' : '') +
                    (notAfter ? '<div class="detail-item"><span class="detail-label">Gültig bis</span><span class="detail-value">' + esc(fmtDate(notAfter)) + '</span></div>' : '') +
                    (kuArr.length ? '<div class="detail-item full-width"><span class="detail-label">Key Usage</span><span class="detail-value">' + esc(kuArr.join(', ')) + '</span></div>' : '') +
                    (selfSigned ? '<div class="detail-item"><span class="detail-label">Self-Signed</span><span class="detail-value">Ja</span></div>' : '') +
                '</div></div>';
        });

        return html || null;
    }

    // ── Chain Warning ────────────────────────────────────────

    function renderChainWarning(sigs, fullData) {
        var existing = document.getElementById('chainWarning');
        if (existing) existing.remove();

        var found = false;
        var json = JSON.stringify(fullData).toLowerCase();

        sigs.forEach(function(sig) {
            var sub = (sig.SubIndication || sig.subIndication || '').toLowerCase();
            if (sub.includes('no_certificate_chain') || sub.includes('chain_constraints_failure') ||
                sub.includes('no_signing_certificate_found')) found = true;

            var chain = sig.CertificateChain || sig.certificateChain;
            if (chain) {
                var certs = toArray(chain.Certificate || chain.certificate || chain);
                var allUntrusted = certs.length > 0 && certs.every(function(c) { return c.trusted !== true && c.Trusted !== true; });
                if (allUntrusted) found = true;
            }
        });

        if (!found && (json.includes('no_certificate_chain') || json.includes('unable_to_build_chain') || json.includes('trust_anchor_not_found'))) {
            found = true;
        }

        if (!found) return;

        var warning = el('div', 'chain-warning');
        warning.id = 'chainWarning';
        warning.innerHTML =
            '<svg class="chain-warning-icon" viewBox="0 0 24 24" fill="none">' +
                '<path d="M12 2L2 22H22L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
                '<path d="M12 10V14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
                '<circle cx="12" cy="18" r="1" fill="currentColor"/></svg>' +
            '<div class="chain-warning-text">' +
                '<strong>Zertifikat nicht vertrauenswürdig</strong>' +
                '<span>Das Zertifikat konnte keiner vertrauenswürdigen Stelle zugeordnet werden. Die Echtheit der Signatur kann nicht bestätigt werden.</span></div>';
        overallStatus.insertAdjacentElement('afterend', warning);
    }

    // ── Registration-Validation Matching ─────────────────────

    function getMatchInput() {
        var isOrg = matchTypeOrg.classList.contains('active');
        if (isOrg) {
            return {
                type: 'org',
                name: document.getElementById('orgName').value.trim(),
                country: document.getElementById('orgCountry').value.trim().toUpperCase(),
                orgId: document.getElementById('orgId').value.trim()
            };
        }
        return {
            type: 'person',
            givenName: document.getElementById('personGivenName').value.trim(),
            surname: document.getElementById('personSurname').value.trim(),
            country: document.getElementById('personCountry').value.trim().toUpperCase(),
            serialNumber: document.getElementById('personSerialNumber').value.trim()
        };
    }

    function extractSubjectDN(diagCert) {
        var subjectDNs = toArray(diagCert.SubjectDistinguishedName || diagCert.subjectDistinguishedName || []);
        var parsed = {};
        subjectDNs.forEach(function(dn) {
            var val = typeof dn === 'object' ? (dn.value || dn.Value || '') : String(dn);
            if (!val) return;
            var parts = val.split(',');
            parts.forEach(function(part) {
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
        var sigArray = rawArray.map(function(item) {
            if (item && item.Signature) return Object.assign({}, item.Signature, { _type: 'signature' });
            if (item && item.Timestamp) return Object.assign({}, item.Timestamp, { _type: 'timestamp' });
            return item;
        }).filter(Boolean);

        var usedCerts = [];
        if (diag) {
            var uc = toArray(diag.UsedCertificates || diag.usedCertificates || diag.Certificate || []);
            uc.forEach(function(c) {
                toArray(c.Certificate || c.certificate || c).forEach(function(item) { usedCerts.push(item); });
            });
            if (!usedCerts.length) usedCerts = uc.slice();
        }

        var results = [];
        sigArray.forEach(function(sig) {
            if (sig._type === 'timestamp') return;
            var chain = sig.CertificateChain || sig.certificateChain;
            if (!chain) return;
            var certs = toArray(chain.Certificate || chain.certificate || chain);
            if (!certs.length) return;
            var signerChainCert = certs[0];
            var certId = signerChainCert.Id || signerChainCert.id || '';
            var diagCert = usedCerts.find(function(c) { return (c.Id || c.id) === certId; });
            var signedBy = sig.SignedBy || sig.signedBy || '';
            var indication = sig.Indication || sig.indication || '';
            results.push({
                signedBy: signedBy,
                indication: indication,
                chainCert: signerChainCert,
                diagCert: diagCert || null,
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
            rows.push({ label: 'Organisation', expected: input.name, found: orgName || signerInfo.signedBy, status: fuzzyMatch(input.name, orgName || signerInfo.signedBy) });
            if (input.country) {
                rows.push({ label: 'Land', expected: input.country, found: dn['C'] || '', status: fuzzyMatch(input.country, dn['C']) });
            }
            if (input.orgId) {
                var foundId = dn['2.5.4.97'] || dn['ORGANIZATIONIDENTIFIER'] || dn['SERIALNUMBER'] || dn['OID.2.5.4.97'] || '';
                rows.push({ label: 'Org-ID', expected: input.orgId, found: foundId, status: fuzzyMatch(input.orgId, foundId) });
            }
        } else {
            var givenName = dn['GIVENNAME'] || dn['G'] || dn['2.5.4.42'] || '';
            var surname = dn['SURNAME'] || dn['SN'] || dn['2.5.4.4'] || '';
            var cn = dn['CN'] || '';
            rows.push({ label: 'Vorname', expected: input.givenName, found: givenName || '', status: givenName ? fuzzyMatch(input.givenName, givenName) : fuzzyMatch(input.givenName, cn) });
            rows.push({ label: 'Nachname', expected: input.surname, found: surname || '', status: surname ? fuzzyMatch(input.surname, surname) : fuzzyMatch(input.surname, cn) });
            if (input.country) {
                rows.push({ label: 'Land', expected: input.country, found: dn['C'] || '', status: fuzzyMatch(input.country, dn['C']) });
            }
            if (input.serialNumber) {
                rows.push({ label: 'Seriennummer', expected: input.serialNumber, found: dn['SERIALNUMBER'] || dn['2.5.4.5'] || '', status: fuzzyMatch(input.serialNumber, dn['SERIALNUMBER'] || dn['2.5.4.5']) });
            }
        }

        var checkedRows = rows.filter(function(r) { return r.status !== 'skip'; });
        var okCount = checkedRows.filter(function(r) { return r.status === 'ok'; }).length;
        var failCount = checkedRows.filter(function(r) { return r.status === 'fail'; }).length;

        var overall;
        if (failCount === 0 && okCount > 0) overall = 'success';
        else if (okCount > 0 && failCount > 0) overall = 'partial';
        else overall = 'failure';

        return { overall: overall, rows: rows, okCount: okCount, failCount: failCount, totalChecked: checkedRows.length };
    }

    function renderMatchResult(simple, diag) {
        var existing = document.getElementById('matchResultContainer');
        if (existing) existing.remove();

        var input = getMatchInput();
        if (input.type === 'org' && !input.name) return;
        if (input.type === 'person' && !input.givenName && !input.surname) return;

        var signers = findSignerCerts(simple, diag);
        if (!signers.length) {
            var noSigDiv = el('div', 'match-result match-failure');
            noSigDiv.id = 'matchResultContainer';
            noSigDiv.innerHTML = '<div class="match-result-header">' + ICONS.invalid +
                '<strong>Keine Signaturen zum Abgleich gefunden</strong></div>' +
                '<p class="match-result-text">Das Dokument enthält keine qualifizierten Signaturen oder Siegel, die mit den Registrierungsdaten verglichen werden können.</p>';
            signaturesList.insertAdjacentElement('beforebegin', noSigDiv);
            return;
        }

        var container = el('div', '');
        container.id = 'matchResultContainer';

        signers.forEach(function(signer, idx) {
            var result = performMatch(input, signer);
            var labels = { success: 'Abgleich erfolgreich', partial: 'Teilweise übereinstimmend', failure: 'Abgleich fehlgeschlagen' };
            var icons = { success: ICONS.valid, partial: ICONS.warning, failure: ICONS.invalid };

            var div = el('div', 'match-result match-' + result.overall);
            div.innerHTML = '<div class="match-result-header">' + icons[result.overall] +
                '<strong>' + esc(labels[result.overall]) + (signers.length > 1 ? ' (' + esc(signer.signedBy) + ')' : '') + '</strong></div>' +
                '<p class="match-result-text">' +
                    result.okCount + ' von ' + result.totalChecked + ' geprüften Feldern stimmen überein.' +
                    (signer.dn._raw ? '<span class="match-subject">Zertifikats-Subject: ' + esc(signer.dn._raw) + '</span>' : '') +
                '</p>' +
                '<div class="match-detail-rows" role="table" aria-label="Abgleich im Detail">' +
                    '<div class="match-row match-row-head" role="row">' +
                        '<span role="columnheader">Feld</span><span role="columnheader">Erwartet</span>' +
                        '<span role="columnheader">Gefunden</span><span role="columnheader">Status</span></div>' +
                    result.rows.map(function(r) {
                        var statusText = { ok: 'OK', fail: 'Fehlt', skip: 'n/a' }[r.status];
                        return '<div class="match-row" role="row">' +
                            '<span class="match-row-label" role="rowheader">' + esc(r.label) + '</span>' +
                            '<span class="match-row-expected" role="cell">' + esc(r.expected || '-') + '</span>' +
                            '<span class="match-row-found" role="cell">' + esc(r.found || '-') + '</span>' +
                            '<span class="match-row-status ' + r.status + '" role="cell">' + statusText + '</span></div>';
                    }).join('') +
                '</div>';

            container.appendChild(div);
        });

        signaturesList.insertAdjacentElement('beforebegin', container);
    }

    // ── Error / Navigation ───────────────────────────────────

    function showError(message) {
        hide(loadingCard, uploadCard, resultsCard); show(errorCard);
        errorMessage.textContent = message;
        retryBtn.focus(); // the button that had focus is now hidden
    }

    retryBtn.addEventListener('click', resetToUpload);
    newValidation.addEventListener('click', resetToUpload);

    function resetToUpload() {
        selectedFile = null; fileInput.value = '';
        uploadZone.classList.remove('hidden'); fileSelected.classList.add('hidden');
        hide(errorCard, resultsCard, loadingCard); show(uploadCard);
        var mc = document.getElementById('matchResultContainer');
        if (mc) mc.remove();
        selectFileBtn.focus();
    }

    // ── Helpers ──────────────────────────────────────────────

    function indicationClass(sig) {
        var ind = (sig.Indication || sig.indication || '').toLowerCase();
        if (ind.includes('passed') || ind === 'valid') return 'valid';
        if (ind.includes('failed') || ind === 'invalid') return 'invalid';
        if (ind.includes('indeterminate')) return 'indeterminate';
        return 'indeterminate';
    }

    function statusLabel(s) {
        return { valid: 'Gültig', invalid: 'Ungültig', indeterminate: 'Unbestimmt', warning: 'Warnung' }[s] || s;
    }

    function fmtSize(b) {
        if (!b) return '0 B';
        var u = ['B', 'KB', 'MB', 'GB'];
        var i = Math.floor(Math.log(b) / Math.log(1024));
        return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i];
    }

    function fmtDate(d) {
        try {
            var dt = new Date(d);
            if (isNaN(dt)) return String(d);
            return dt.toLocaleString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch (e) { return String(d); }
    }

    function esc(s) {
        var d = document.createElement('div'); d.textContent = s; return d.innerHTML;
    }

    function el(tag, cls) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        return e;
    }

    function toArray(v) {
        if (Array.isArray(v)) return v;
        if (v && typeof v === 'object' && !Array.isArray(v)) return [v];
        return v ? [v] : [];
    }

    function show(el) { el.classList.remove('hidden'); }
    function hide() { for (var i = 0; i < arguments.length; i++) arguments[i].classList.add('hidden'); }

    // ── UI chrome: keyboard access, mode state, header navigation ──

    // Enter / Space opens signature cards and accordions (they are role="button" divs)
    signaturesList.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var t = e.target;
        if (t.classList && (t.classList.contains('signature-header') || t.classList.contains('accordion-trigger'))) {
            e.preventDefault();
            t.click();
        }
    });

    function syncModeUi() {
        modeTabs.querySelectorAll('.mode-tab').forEach(function(t) {
            t.setAttribute('aria-pressed', String(t.classList.contains('active')));
        });
    }
    modeTabs.addEventListener('click', syncModeUi);

    function syncMatchTypeUi() {
        matchTypeOrg.setAttribute('aria-pressed', String(matchTypeOrg.classList.contains('active')));
        matchTypePerson.setAttribute('aria-pressed', String(matchTypePerson.classList.contains('active')));
    }
    matchTypeOrg.addEventListener('click', syncMatchTypeUi);
    matchTypePerson.addEventListener('click', syncMatchTypeUi);

    var navToggle = document.getElementById('navToggle');
    var siteNav = document.getElementById('siteNav');

    function setNavOpen(open) {
        if (!navToggle || !siteNav) return;
        navToggle.setAttribute('aria-expanded', String(open));
        navToggle.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
        siteNav.classList.toggle('open', open);
    }

    if (navToggle && siteNav) {
        navToggle.addEventListener('click', function() {
            setNavOpen(navToggle.getAttribute('aria-expanded') !== 'true');
        });
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && navToggle.getAttribute('aria-expanded') === 'true') {
                setNavOpen(false);
                navToggle.focus();
            }
        });
        siteNav.querySelectorAll('a').forEach(function(a) {
            a.addEventListener('click', function() { setNavOpen(false); });
        });
    }

    // Header / footer links that switch the validator mode
    document.querySelectorAll('[data-mode-link]').forEach(function(link) {
        link.addEventListener('click', function(e) {
            var tab = modeTabs.querySelector('.mode-tab[data-mode="' + link.dataset.modeLink + '"]');
            if (!tab) return;
            e.preventDefault();
            if (!tab.classList.contains('active')) tab.click();
            var tool = document.getElementById('validator');
            var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (tool) tool.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
            tab.focus({ preventScroll: true });
        });
    });

})();

/**
 * SIGN8 Validator - PDF Signature Validation App
 * Uses SIGN8 SVA API (DSS-based) for document validation
 * Parses EU DSS SimpleReport / DetailedReport / DiagnosticData format
 */

(function () {
    'use strict';

    // ========================================
    // Configuration
    // ========================================

    const API_URL = 'https://api.uat.sign8.eu/sva/v1/validation/document/raw';
    const CORS_PROXY = 'https://corsproxy.io/?url=';
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

    // ========================================
    // DOM Elements
    // ========================================

    const uploadCard = document.getElementById('uploadCard');
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    const selectFileBtn = document.getElementById('selectFileBtn');
    const fileSelected = document.getElementById('fileSelected');
    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');
    const removeFile = document.getElementById('removeFile');
    const validateBtn = document.getElementById('validateBtn');
    const loadingCard = document.getElementById('loadingCard');
    const resultsCard = document.getElementById('resultsCard');
    const docName = document.getElementById('docName');
    const docMeta = document.getElementById('docMeta');
    const overallStatus = document.getElementById('overallStatus');
    const signaturesList = document.getElementById('signaturesList');
    const rawJson = document.getElementById('rawJson');
    const newValidation = document.getElementById('newValidation');
    const errorCard = document.getElementById('errorCard');
    const errorMessage = document.getElementById('errorMessage');
    const retryBtn = document.getElementById('retryBtn');

    // ========================================
    // State
    // ========================================

    let selectedFile = null;

    // ========================================
    // File Upload Handling
    // ========================================

    selectFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });

    uploadZone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadZone.classList.add('drag-over');
    });

    uploadZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadZone.classList.remove('drag-over');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadZone.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });

    document.body.addEventListener('dragover', (e) => e.preventDefault());
    document.body.addEventListener('drop', (e) => e.preventDefault());

    function handleFile(file) {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            showError('Bitte laden Sie eine PDF-Datei hoch.');
            return;
        }
        if (file.size > MAX_FILE_SIZE) {
            showError('Die Datei ist zu groß. Maximale Dateigröße: 10 MB.');
            return;
        }
        selectedFile = file;
        showFileSelected();
    }

    function showFileSelected() {
        fileName.textContent = selectedFile.name;
        fileSize.textContent = formatFileSize(selectedFile.size);
        uploadZone.classList.add('hidden');
        fileSelected.classList.remove('hidden');
    }

    removeFile.addEventListener('click', () => {
        resetUpload();
    });

    function resetUpload() {
        selectedFile = null;
        fileInput.value = '';
        uploadZone.classList.remove('hidden');
        fileSelected.classList.add('hidden');
    }

    // ========================================
    // Validation
    // ========================================

    validateBtn.addEventListener('click', () => {
        if (!selectedFile) return;
        startValidation();
    });

    async function startValidation() {
        uploadCard.classList.add('hidden');
        resultsCard.classList.add('hidden');
        errorCard.classList.add('hidden');
        loadingCard.classList.remove('hidden');

        try {
            const base64 = await fileToBase64(selectedFile);
            const targetUrl = encodeURIComponent(API_URL);
            const response = await fetch(CORS_PROXY + targetUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ document: base64 })
            });

            if (!response.ok) {
                let errorText = `HTTP ${response.status}`;
                try {
                    const errorBody = await response.json();
                    errorText = errorBody.message || errorBody.error || errorText;
                } catch { /* use status code */ }
                throw new Error(errorText);
            }

            const data = await response.json();
            showResults(data);

        } catch (error) {
            console.error('Validation error:', error);
            showError(error.message || 'Ein unbekannter Fehler ist aufgetreten.');
        }
    }

    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
            reader.readAsDataURL(file);
        });
    }

    // ========================================
    // DSS Response Parsing
    // ========================================

    /**
     * Locate the SimpleReport inside the DSS response.
     * The /raw endpoint may return:
     *   { SimpleReport: {...} }
     *   { simpleReport: {...} }
     *   { validationReport: { simpleReport: {...} } }
     *   or the SimpleReport itself at root level
     */
    function findSimpleReport(data) {
        if (data.SimpleReport) return data.SimpleReport;
        if (data.simpleReport) return data.simpleReport;
        if (data.validationReport?.simpleReport) return data.validationReport.simpleReport;
        if (data.validationReport?.SimpleReport) return data.validationReport.SimpleReport;
        // Check if root IS the SimpleReport (has signatureOrTimestamp or Signature)
        if (data.signatureOrTimestamp || data.Signature || data.validSignaturesCount !== undefined) return data;
        return null;
    }

    function findDetailedReport(data) {
        return data.DetailedReport || data.detailedReport ||
               data.validationReport?.detailedReport || data.validationReport?.DetailedReport || null;
    }

    function findDiagnosticData(data) {
        return data.DiagnosticData || data.diagnosticData ||
               data.validationReport?.diagnosticData || data.validationReport?.DiagnosticData || null;
    }

    /**
     * Extract signature objects from SimpleReport.
     * DSS uses signatureOrTimestamp[] array with Signature/Timestamp objects,
     * or flat Signature[] arrays.
     */
    function extractDSSSignatures(simpleReport) {
        if (!simpleReport) return [];

        // signatureOrTimestamp is the standard DSS array
        if (simpleReport.signatureOrTimestamp && Array.isArray(simpleReport.signatureOrTimestamp)) {
            return simpleReport.signatureOrTimestamp
                .map(item => item.Signature || item.signature || item)
                .filter(Boolean);
        }

        // Direct Signature array
        if (simpleReport.Signature) {
            return Array.isArray(simpleReport.Signature) ? simpleReport.Signature : [simpleReport.Signature];
        }
        if (simpleReport.signatures) {
            return Array.isArray(simpleReport.signatures) ? simpleReport.signatures : [simpleReport.signatures];
        }

        return [];
    }

    /**
     * Extract timestamps from SimpleReport
     */
    function extractDSSTimestamps(simpleReport) {
        if (!simpleReport) return [];

        if (simpleReport.signatureOrTimestamp && Array.isArray(simpleReport.signatureOrTimestamp)) {
            return simpleReport.signatureOrTimestamp
                .map(item => item.Timestamp || item.timestamp)
                .filter(Boolean);
        }

        if (simpleReport.Timestamp) {
            return Array.isArray(simpleReport.Timestamp) ? simpleReport.Timestamp : [simpleReport.Timestamp];
        }

        return [];
    }

    // ========================================
    // Results Display
    // ========================================

    function showResults(data) {
        loadingCard.classList.add('hidden');
        resultsCard.classList.remove('hidden');

        docName.textContent = selectedFile.name;
        docMeta.textContent = formatFileSize(selectedFile.size);
        rawJson.textContent = JSON.stringify(data, null, 2);

        renderValidationResults(data);
    }

    function renderValidationResults(data) {
        const simpleReport = findSimpleReport(data);
        const detailedReport = findDetailedReport(data);
        const diagnosticData = findDiagnosticData(data);
        const signatures = extractDSSSignatures(simpleReport);
        const timestamps = extractDSSTimestamps(simpleReport);

        // Update document info from SimpleReport
        if (simpleReport) {
            const srDocName = simpleReport.DocumentName || simpleReport.documentName;
            if (srDocName) {
                docMeta.textContent = srDocName + ' | ' + formatFileSize(selectedFile.size);
            }
        }

        // Determine overall status
        const overall = determineOverallStatus(simpleReport, signatures, data);
        renderOverallStatus(overall);

        // Certificate chain warning
        renderChainWarning(signatures, data);

        // Validation policy
        renderValidationPolicy(simpleReport);

        // Render signatures
        renderSignatures(signatures, detailedReport, diagnosticData);

        // Render timestamps if present
        if (timestamps.length > 0) {
            renderTimestamps(timestamps);
        }

        // Render summary counts
        renderSummaryCounts(simpleReport, signatures);
    }

    function determineOverallStatus(simpleReport, signatures, fullData) {
        // Check SimpleReport-level fields
        if (simpleReport) {
            const validCount = simpleReport.ValidSignaturesCount ?? simpleReport.validSignaturesCount;
            const totalCount = simpleReport.SignaturesCount ?? simpleReport.signaturesCount;

            if (totalCount !== undefined && totalCount === 0) {
                return { status: 'info', label: 'Keine Signaturen gefunden', description: 'Das Dokument enthält keine digitalen Signaturen oder Siegel.' };
            }

            if (validCount !== undefined && totalCount !== undefined) {
                if (validCount === totalCount && totalCount > 0) {
                    return { status: 'valid', label: 'Alle Signaturen gültig', description: `${validCount} von ${totalCount} Signatur(en) erfolgreich validiert.` };
                }
                if (validCount === 0) {
                    return { status: 'invalid', label: 'Ungültig', description: `Keine der ${totalCount} Signatur(en) konnte validiert werden.` };
                }
                return { status: 'warning', label: 'Teilweise gültig', description: `${validCount} von ${totalCount} Signatur(en) gültig.` };
            }
        }

        // Fallback: derive from individual signatures
        if (signatures.length === 0) {
            // Check top-level indication
            const topIndication = fullData.indication || fullData.Indication;
            if (topIndication) return normalizeIndication(topIndication);
            return { status: 'info', label: 'Keine Signaturen gefunden', description: 'Das Dokument enthält keine digitalen Signaturen oder Siegel.' };
        }

        const hasInvalid = signatures.some(s => getDSSStatus(s) === 'invalid');
        const hasIndeterminate = signatures.some(s => getDSSStatus(s) === 'indeterminate');

        if (hasInvalid) return { status: 'invalid', label: 'Ungültig', description: 'Eine oder mehrere Signaturen sind ungültig.' };
        if (hasIndeterminate) return { status: 'warning', label: 'Eingeschränkt gültig', description: 'Einige Signaturen konnten nicht vollständig validiert werden.' };
        return { status: 'valid', label: 'Alle Signaturen gültig', description: 'Alle Signaturen wurden erfolgreich validiert.' };
    }

    function normalizeIndication(indication) {
        const s = String(indication).toUpperCase();
        if (s === 'TOTAL_PASSED' || s === 'PASSED') return { status: 'valid', label: 'Gültig', description: 'Signatur erfolgreich validiert.' };
        if (s === 'TOTAL_FAILED' || s === 'FAILED') return { status: 'invalid', label: 'Ungültig', description: 'Signatur ist ungültig.' };
        if (s === 'INDETERMINATE') return { status: 'warning', label: 'Unbestimmt', description: 'Die Validierung konnte kein eindeutiges Ergebnis liefern.' };
        return { status: 'info', label: indication, description: '' };
    }

    function getDSSStatus(sig) {
        const indication = String(sig.Indication || sig.indication || '').toUpperCase();
        if (indication === 'TOTAL_PASSED' || indication === 'PASSED') return 'valid';
        if (indication === 'TOTAL_FAILED' || indication === 'FAILED') return 'invalid';
        if (indication === 'INDETERMINATE') return 'indeterminate';
        return 'indeterminate';
    }

    // ========================================
    // Overall Status Rendering
    // ========================================

    function renderOverallStatus(overall) {
        const statusIcons = {
            valid: '<svg class="status-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M8 12L11 15L16 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            invalid: '<svg class="status-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M8 8L16 16M16 8L8 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
            warning: '<svg class="status-icon" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 22H22L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10V14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="18" r="1" fill="currentColor"/></svg>',
            info: '<svg class="status-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 8V12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>'
        };

        overallStatus.className = `overall-status status-${overall.status}`;
        overallStatus.innerHTML = `
            ${statusIcons[overall.status] || statusIcons.info}
            <div>
                <strong>${escapeHtml(overall.label)}</strong>
                ${overall.description ? `<div style="font-weight:400;font-size:0.85rem;margin-top:2px;opacity:0.85">${escapeHtml(overall.description)}</div>` : ''}
            </div>
        `;
    }

    // ========================================
    // Certificate Chain Warning
    // ========================================

    const CHAIN_KEYWORDS = [
        'no_certificate_chain', 'no_chain', 'chain_constraints_failure',
        'unable_to_build_chain', 'certificate_chain_not_found',
        'no_trusted', 'not_trusted', 'trust_anchor_not_found'
    ];

    function hasChainIssue(sig) {
        const subInd = String(sig.SubIndication || sig.subIndication || '').toLowerCase();
        if (CHAIN_KEYWORDS.some(kw => subInd.includes(kw))) return true;

        // Check certificate chain for untrusted certs
        const chain = sig.CertificateChain || sig.certificateChain;
        if (chain) {
            const certs = chain.Certificate || chain.certificate || [];
            const certArr = Array.isArray(certs) ? certs : [certs];
            const allUntrusted = certArr.length > 0 && certArr.every(c =>
                c.trusted === false || c.Trusted === false
            );
            if (allUntrusted) return true;
        }

        // Check AdES validation details for chain errors
        const details = sig.AdESValidationDetails || sig.adESValidationDetails;
        if (details) {
            const errors = details.Error || details.error || [];
            const errArr = Array.isArray(errors) ? errors : [errors];
            for (const err of errArr) {
                const errMsg = String(err.value || err.Value || err || '').toLowerCase();
                if (CHAIN_KEYWORDS.some(kw => errMsg.includes(kw))) return true;
                if (errMsg.includes('certificate chain') || errMsg.includes('trusted list')) return true;
            }
        }

        return false;
    }

    function renderChainWarning(signatures, fullData) {
        const existing = document.getElementById('chainWarning');
        if (existing) existing.remove();

        let chainIssueFound = signatures.some(sig => hasChainIssue(sig));

        if (!chainIssueFound) {
            const fullStr = JSON.stringify(fullData).toLowerCase();
            if (!CHAIN_KEYWORDS.some(kw => fullStr.includes(kw))) return;
            chainIssueFound = true;
        }

        const warning = document.createElement('div');
        warning.id = 'chainWarning';
        warning.className = 'chain-warning';
        warning.innerHTML = `
            <svg class="chain-warning-icon" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 22H22L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                <path d="M12 10V14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <circle cx="12" cy="18" r="1" fill="currentColor"/>
            </svg>
            <div class="chain-warning-text">
                <strong>Zertifikat nicht vertrauenswürdig</strong>
                <span>Das Zertifikat konnte keiner vertrauenswürdigen Stelle zugeordnet werden. Die Echtheit der Signatur kann nicht bestätigt werden.</span>
            </div>
        `;
        overallStatus.insertAdjacentElement('afterend', warning);
    }

    // ========================================
    // Validation Policy
    // ========================================

    function renderValidationPolicy(simpleReport) {
        const existing = document.getElementById('validationPolicy');
        if (existing) existing.remove();
        if (!simpleReport) return;

        const policy = simpleReport.ValidationPolicy || simpleReport.validationPolicy ||
                       simpleReport.Policy || simpleReport.policy;
        if (!policy) return;

        const policyName = policy.PolicyName || policy.policyName || '';
        const policyDesc = policy.PolicyDescription || policy.policyDescription || '';
        if (!policyName && !policyDesc) return;

        const el = document.createElement('div');
        el.id = 'validationPolicy';
        el.className = 'validation-policy';
        el.innerHTML = `
            <span class="policy-label">Validierungsrichtlinie</span>
            <span class="policy-name">${escapeHtml(policyName)}</span>
            ${policyDesc ? `<span class="policy-desc">${escapeHtml(policyDesc)}</span>` : ''}
        `;

        const docInfo = document.getElementById('docInfo');
        docInfo.insertAdjacentElement('afterend', el);
    }

    // ========================================
    // Signature Rendering (DSS format)
    // ========================================

    function renderSignatures(signatures, detailedReport, diagnosticData) {
        signaturesList.innerHTML = '';

        if (signatures.length === 0) {
            const item = document.createElement('div');
            item.className = 'signature-item';
            item.innerHTML = `
                <div class="signature-header">
                    <div class="sig-status-badge indeterminate">Info</div>
                    <div class="sig-info">
                        <span class="sig-name">Keine Signaturen im Dokument</span>
                        <span class="sig-meta">Das Dokument enthält keine digitalen Signaturen</span>
                    </div>
                </div>
            `;
            signaturesList.appendChild(item);
            return;
        }

        signatures.forEach((sig, index) => {
            const status = getDSSStatus(sig);
            const indication = sig.Indication || sig.indication || '';
            const subIndication = sig.SubIndication || sig.subIndication || '';
            const signedBy = sig.SignedBy || sig.signedBy || `Signatur ${index + 1}`;
            const signingTime = sig.SigningTime || sig.signingTime || '';
            const bestSigTime = sig.BestSignatureTime || sig.bestSignatureTime || '';
            const sigFormat = sig.SignatureFormat || sig.signatureFormat || '';
            const sigId = sig.Id || sig.id || '';

            // Signature level (can be object with value + description)
            const sigLevel = sig.SignatureLevel || sig.signatureLevel || '';
            const sigLevelValue = typeof sigLevel === 'object'
                ? (sigLevel.value || sigLevel.Value || sigLevel.description || JSON.stringify(sigLevel))
                : sigLevel;
            const sigLevelDesc = typeof sigLevel === 'object'
                ? (sigLevel.description || sigLevel.Description || '')
                : '';

            // Certificate chain
            const chain = sig.CertificateChain || sig.certificateChain;
            const chainCerts = chain ? (chain.Certificate || chain.certificate || []) : [];
            const chainArr = Array.isArray(chainCerts) ? chainCerts : [chainCerts];

            // Signature scopes
            const scopes = sig.SignatureScope || sig.signatureScope || [];
            const scopeArr = Array.isArray(scopes) ? scopes : [scopes];

            // AdES validation details (errors/warnings/info)
            const adesDetails = sig.AdESValidationDetails || sig.adESValidationDetails;
            const qualDetails = sig.QualificationDetails || sig.qualificationDetails;

            const statusLabels = {
                valid: 'Gültig',
                invalid: 'Ungültig',
                indeterminate: 'Unbestimmt'
            };

            const item = document.createElement('div');
            item.className = 'signature-item';

            item.innerHTML = `
                <div class="signature-header" onclick="this.parentElement.querySelector('.signature-details').classList.toggle('open'); this.querySelector('.sig-expand').classList.toggle('expanded')">
                    <div class="sig-status-badge ${status}">${statusLabels[status] || status}</div>
                    <div class="sig-info">
                        <span class="sig-name">${escapeHtml(String(signedBy))}</span>
                        <span class="sig-meta">
                            ${sigFormat ? escapeHtml(sigFormat) : ''}
                            ${signingTime ? ' | ' + escapeHtml(formatDate(signingTime)) : ''}
                        </span>
                    </div>
                    <svg class="sig-expand" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <div class="signature-details">
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span class="detail-label">Indication</span>
                            <span class="detail-value dss-indication ${status}">${escapeHtml(String(indication))}</span>
                        </div>
                        ${subIndication ? `
                        <div class="detail-item">
                            <span class="detail-label">Sub-Indication</span>
                            <span class="detail-value">${escapeHtml(String(subIndication))}</span>
                        </div>` : ''}
                        <div class="detail-item">
                            <span class="detail-label">Unterzeichner</span>
                            <span class="detail-value">${escapeHtml(String(signedBy))}</span>
                        </div>
                        ${sigFormat ? `
                        <div class="detail-item">
                            <span class="detail-label">Signaturformat</span>
                            <span class="detail-value">${escapeHtml(String(sigFormat))}</span>
                        </div>` : ''}
                        ${sigLevelValue ? `
                        <div class="detail-item">
                            <span class="detail-label">Signaturlevel</span>
                            <span class="detail-value">${escapeHtml(String(sigLevelValue))}${sigLevelDesc ? ' (' + escapeHtml(sigLevelDesc) + ')' : ''}</span>
                        </div>` : ''}
                        ${signingTime ? `
                        <div class="detail-item">
                            <span class="detail-label">Signaturzeitpunkt</span>
                            <span class="detail-value">${escapeHtml(formatDate(signingTime))}</span>
                        </div>` : ''}
                        ${bestSigTime ? `
                        <div class="detail-item">
                            <span class="detail-label">Bester Signaturzeitpunkt</span>
                            <span class="detail-value">${escapeHtml(formatDate(bestSigTime))}</span>
                        </div>` : ''}
                        ${sigId ? `
                        <div class="detail-item full-width">
                            <span class="detail-label">Signatur-ID</span>
                            <span class="detail-value" style="font-size:0.75rem;word-break:break-all">${escapeHtml(String(sigId))}</span>
                        </div>` : ''}
                    </div>

                    ${renderCertificateChain(chainArr)}
                    ${renderSignatureScopes(scopeArr)}
                    ${renderValidationDetails('AdES-Validierung', adesDetails)}
                    ${renderValidationDetails('Qualifizierungsprüfung', qualDetails)}
                </div>
            `;
            signaturesList.appendChild(item);
        });
    }

    // ========================================
    // Certificate Chain Rendering
    // ========================================

    function renderCertificateChain(certs) {
        if (!certs || certs.length === 0) return '';

        let html = '<div class="cert-chain-section"><span class="detail-label" style="margin-top:1rem;display:block">Zertifikatskette</span>';
        certs.forEach((cert, i) => {
            const certName = cert.QualifiedName || cert.qualifiedName || cert.Id || cert.id || `Zertifikat ${i + 1}`;
            const trusted = cert.trusted ?? cert.Trusted;
            const trustIcon = trusted === true
                ? '<span class="trust-badge trusted">Vertrauenswürdig</span>'
                : trusted === false
                    ? '<span class="trust-badge untrusted">Nicht vertrauenswürdig</span>'
                    : '';

            // Trust anchors
            const anchors = cert.TrustAnchors || cert.trustAnchors;
            let anchorHtml = '';
            if (anchors) {
                const anchorArr = anchors.TrustAnchor || anchors.trustAnchor || [];
                const arr = Array.isArray(anchorArr) ? anchorArr : [anchorArr];
                if (arr.length > 0) {
                    anchorHtml = '<div class="trust-anchors">' + arr.map(a => {
                        const tsp = a.TrustServiceProvider || a.trustServiceProvider || '';
                        const tsn = a.TrustServiceName || a.trustServiceName || '';
                        const cc = a.countryCode || a.CountryCode || '';
                        return `<span class="anchor-item">${cc ? '🏳 ' + escapeHtml(cc) + ' | ' : ''}${escapeHtml(tsp || tsn)}</span>`;
                    }).join('') + '</div>';
                }
            }

            html += `
                <div class="cert-item">
                    <div class="cert-header">
                        <span class="cert-index">${i + 1}</span>
                        <span class="cert-name">${escapeHtml(String(certName))}</span>
                        ${trustIcon}
                    </div>
                    ${anchorHtml}
                </div>
            `;
        });
        html += '</div>';
        return html;
    }

    // ========================================
    // Signature Scopes Rendering
    // ========================================

    function renderSignatureScopes(scopes) {
        if (!scopes || scopes.length === 0) return '';
        const validScopes = scopes.filter(s => s && (s.value || s.Value || s.name || s.Name));
        if (validScopes.length === 0) return '';

        let html = '<div class="scope-section"><span class="detail-label" style="margin-top:1rem;display:block">Signaturumfang</span>';
        validScopes.forEach(scope => {
            const name = scope.name || scope.Name || '';
            const scopeType = scope.scope || scope.Scope || '';
            const value = scope.value || scope.Value || '';
            html += `
                <div class="scope-item">
                    ${name ? `<span class="scope-name">${escapeHtml(name)}</span>` : ''}
                    ${scopeType ? `<span class="scope-type">${escapeHtml(scopeType)}</span>` : ''}
                    ${value ? `<span class="scope-value">${escapeHtml(value)}</span>` : ''}
                </div>
            `;
        });
        html += '</div>';
        return html;
    }

    // ========================================
    // Validation Details (Errors/Warnings/Info)
    // ========================================

    function renderValidationDetails(title, details) {
        if (!details) return '';

        const errors = extractMessages(details.Error || details.error);
        const warnings = extractMessages(details.Warning || details.warning);
        const infos = extractMessages(details.Info || details.info);

        if (errors.length === 0 && warnings.length === 0 && infos.length === 0) return '';

        let html = `<div class="validation-details-section"><span class="detail-label" style="margin-top:1rem;display:block">${escapeHtml(title)}</span>`;

        errors.forEach(msg => {
            html += `<div class="vd-message vd-error"><span class="vd-badge">Fehler</span>${escapeHtml(msg)}</div>`;
        });
        warnings.forEach(msg => {
            html += `<div class="vd-message vd-warning"><span class="vd-badge">Warnung</span>${escapeHtml(msg)}</div>`;
        });
        infos.forEach(msg => {
            html += `<div class="vd-message vd-info"><span class="vd-badge">Info</span>${escapeHtml(msg)}</div>`;
        });

        html += '</div>';
        return html;
    }

    function extractMessages(items) {
        if (!items) return [];
        const arr = Array.isArray(items) ? items : [items];
        return arr.map(item => {
            if (typeof item === 'string') return item;
            return item.value || item.Value || item.message || item.Message || JSON.stringify(item);
        }).filter(Boolean);
    }

    // ========================================
    // Timestamps Rendering
    // ========================================

    function renderTimestamps(timestamps) {
        timestamps.forEach((ts, index) => {
            const status = getDSSStatus(ts);
            const producedBy = ts.ProducedBy || ts.producedBy || `Zeitstempel ${index + 1}`;
            const productionTime = ts.ProductionTime || ts.productionTime || '';
            const tsLevel = ts.TimestampLevel || ts.timestampLevel || '';
            const indication = ts.Indication || ts.indication || '';
            const subIndication = ts.SubIndication || ts.subIndication || '';

            const statusLabels = { valid: 'Gültig', invalid: 'Ungültig', indeterminate: 'Unbestimmt' };

            const item = document.createElement('div');
            item.className = 'signature-item timestamp-item';
            item.innerHTML = `
                <div class="signature-header" onclick="this.parentElement.querySelector('.signature-details').classList.toggle('open'); this.querySelector('.sig-expand').classList.toggle('expanded')">
                    <div class="sig-status-badge ${status}">${statusLabels[status] || status}</div>
                    <div class="sig-info">
                        <span class="sig-name">Zeitstempel: ${escapeHtml(String(producedBy))}</span>
                        ${productionTime ? `<span class="sig-meta">${escapeHtml(formatDate(productionTime))}</span>` : ''}
                    </div>
                    <svg class="sig-expand" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <div class="signature-details">
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span class="detail-label">Indication</span>
                            <span class="detail-value dss-indication ${status}">${escapeHtml(String(indication))}</span>
                        </div>
                        ${subIndication ? `<div class="detail-item"><span class="detail-label">Sub-Indication</span><span class="detail-value">${escapeHtml(String(subIndication))}</span></div>` : ''}
                        ${tsLevel ? `<div class="detail-item"><span class="detail-label">Zeitstempel-Level</span><span class="detail-value">${escapeHtml(String(tsLevel))}</span></div>` : ''}
                        ${productionTime ? `<div class="detail-item"><span class="detail-label">Erstellungszeitpunkt</span><span class="detail-value">${escapeHtml(formatDate(productionTime))}</span></div>` : ''}
                    </div>
                </div>
            `;
            signaturesList.appendChild(item);
        });
    }

    // ========================================
    // Summary Counts
    // ========================================

    function renderSummaryCounts(simpleReport, signatures) {
        const existing = document.getElementById('summaryCounts');
        if (existing) existing.remove();
        if (!simpleReport) return;

        const validCount = simpleReport.ValidSignaturesCount ?? simpleReport.validSignaturesCount;
        const totalCount = simpleReport.SignaturesCount ?? simpleReport.signaturesCount;
        if (validCount === undefined && totalCount === undefined) return;

        const el = document.createElement('div');
        el.id = 'summaryCounts';
        el.className = 'summary-counts';
        el.innerHTML = `
            <div class="count-item">
                <span class="count-number">${totalCount ?? signatures.length}</span>
                <span class="count-label">Signaturen gesamt</span>
            </div>
            <div class="count-item count-valid">
                <span class="count-number">${validCount ?? '?'}</span>
                <span class="count-label">Gültig</span>
            </div>
            <div class="count-item count-invalid">
                <span class="count-number">${(totalCount ?? 0) - (validCount ?? 0)}</span>
                <span class="count-label">Ungültig / Unbestimmt</span>
            </div>
        `;

        // Insert before raw response
        const rawResponse = document.querySelector('.raw-response');
        rawResponse.insertAdjacentElement('beforebegin', el);
    }

    // ========================================
    // Error Handling
    // ========================================

    function showError(message) {
        loadingCard.classList.add('hidden');
        uploadCard.classList.add('hidden');
        resultsCard.classList.add('hidden');
        errorCard.classList.remove('hidden');
        errorMessage.textContent = message;
    }

    retryBtn.addEventListener('click', () => resetToUpload());
    newValidation.addEventListener('click', () => resetToUpload());

    function resetToUpload() {
        selectedFile = null;
        fileInput.value = '';
        uploadZone.classList.remove('hidden');
        fileSelected.classList.add('hidden');
        errorCard.classList.add('hidden');
        resultsCard.classList.add('hidden');
        loadingCard.classList.add('hidden');
        uploadCard.classList.remove('hidden');
        // Clean up dynamic elements
        ['chainWarning', 'validationPolicy', 'summaryCounts'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
    }

    // ========================================
    // Utilities
    // ========================================

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function formatDate(dateStr) {
        try {
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return String(dateStr);
            return date.toLocaleString('de-DE', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
        } catch {
            return String(dateStr);
        }
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

})();

/**
 * SIGN8 Validator - PDF Signature Validation App
 * Uses SIGN8 SVA API for document validation
 */

(function () {
    'use strict';

    // ========================================
    // Configuration
    // ========================================

    const API_URL = 'https://api.uat.sign8.eu/sva/v1/validation/document';
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

    // Click to select file
    selectFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });

    uploadZone.addEventListener('click', () => {
        fileInput.click();
    });

    // File input change
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    // Drag and drop
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

    // Prevent default drag behavior on body
    document.body.addEventListener('dragover', (e) => e.preventDefault());
    document.body.addEventListener('drop', (e) => e.preventDefault());

    function handleFile(file) {
        // Validate file type
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            showError('Bitte laden Sie eine PDF-Datei hoch.');
            return;
        }

        // Validate file size
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

    // Remove file
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
        // Show loading
        uploadCard.classList.add('hidden');
        resultsCard.classList.add('hidden');
        errorCard.classList.add('hidden');
        loadingCard.classList.remove('hidden');

        try {
            // Convert PDF to base64
            const base64 = await fileToBase64(selectedFile);

            // Call API
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    document: base64
                })
            });

            if (!response.ok) {
                let errorText = `HTTP ${response.status}`;
                try {
                    const errorBody = await response.json();
                    errorText = errorBody.message || errorBody.error || errorText;
                } catch {
                    // use status code text
                }
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
            reader.onload = () => {
                // Remove the data:application/pdf;base64, prefix
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
            reader.readAsDataURL(file);
        });
    }

    // ========================================
    // Results Display
    // ========================================

    function showResults(data) {
        loadingCard.classList.add('hidden');
        resultsCard.classList.remove('hidden');

        // Document info
        docName.textContent = selectedFile.name;
        docMeta.textContent = formatFileSize(selectedFile.size);

        // Raw JSON
        rawJson.textContent = JSON.stringify(data, null, 2);

        // Parse and display results
        renderValidationResults(data);
    }

    function renderValidationResults(data) {
        // Try to determine overall status and signatures from API response
        // Adapt to the actual API response structure
        const signatures = extractSignatures(data);
        const overall = determineOverallStatus(data, signatures);

        // Render overall status
        renderOverallStatus(overall);

        // Render signatures
        renderSignatures(signatures, data);
    }

    function extractSignatures(data) {
        // Handle various possible API response structures
        if (data.signatures && Array.isArray(data.signatures)) {
            return data.signatures;
        }
        if (data.signatureValidationResults && Array.isArray(data.signatureValidationResults)) {
            return data.signatureValidationResults;
        }
        if (data.validationResult && data.validationResult.signatures) {
            return data.validationResult.signatures;
        }
        if (data.validationReport && data.validationReport.signatureValidationObjects) {
            return data.validationReport.signatureValidationObjects;
        }
        if (data.results && Array.isArray(data.results)) {
            return data.results;
        }
        // If the data itself has signature-like properties
        if (data.signatureStatus || data.indication || data.subIndication) {
            return [data];
        }
        return [];
    }

    function determineOverallStatus(data, signatures) {
        // Check for explicit overall status in response
        if (data.overallStatus) return normalizeStatus(data.overallStatus);
        if (data.validationStatus) return normalizeStatus(data.validationStatus);
        if (data.indication) return normalizeStatus(data.indication);
        if (data.status) return normalizeStatus(data.status);

        // Determine from signatures
        if (signatures.length === 0) {
            return { status: 'info', label: 'Keine Signaturen gefunden', description: 'Das Dokument enthält keine digitalen Signaturen oder Siegel.' };
        }

        const hasInvalid = signatures.some(s => {
            const status = getSignatureStatus(s);
            return status === 'invalid';
        });

        const hasWarning = signatures.some(s => {
            const status = getSignatureStatus(s);
            return status === 'warning' || status === 'indeterminate';
        });

        if (hasInvalid) {
            return { status: 'invalid', label: 'Ungültig', description: 'Eine oder mehrere Signaturen sind ungültig.' };
        }
        if (hasWarning) {
            return { status: 'warning', label: 'Eingeschränkt gültig', description: 'Einige Signaturen konnten nicht vollständig validiert werden.' };
        }
        return { status: 'valid', label: 'Gültig', description: 'Alle Signaturen sind gültig.' };
    }

    function normalizeStatus(status) {
        const s = String(status).toLowerCase();
        if (s === 'total_passed' || s === 'valid' || s === 'passed' || s === 'ok' || s === 'success') {
            return { status: 'valid', label: 'Gültig', description: 'Alle Signaturen sind gültig.' };
        }
        if (s === 'total_failed' || s === 'invalid' || s === 'failed' || s === 'error') {
            return { status: 'invalid', label: 'Ungültig', description: 'Eine oder mehrere Signaturen sind ungültig.' };
        }
        if (s === 'indeterminate' || s === 'warning' || s === 'partial') {
            return { status: 'warning', label: 'Eingeschränkt gültig', description: 'Einige Signaturen konnten nicht vollständig validiert werden.' };
        }
        if (s === 'no_signature' || s === 'no_signatures_found') {
            return { status: 'info', label: 'Keine Signaturen', description: 'Das Dokument enthält keine digitalen Signaturen.' };
        }
        return { status: 'info', label: status, description: '' };
    }

    function getSignatureStatus(sig) {
        const indication = (sig.indication || sig.status || sig.signatureStatus || sig.validationStatus || '').toLowerCase();
        if (indication.includes('passed') || indication.includes('valid') || indication === 'ok') return 'valid';
        if (indication.includes('failed') || indication.includes('invalid') || indication === 'error') return 'invalid';
        if (indication.includes('indeterminate')) return 'indeterminate';
        if (indication.includes('warning')) return 'warning';
        return 'indeterminate';
    }

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

    function renderSignatures(signatures, fullData) {
        signaturesList.innerHTML = '';

        if (signatures.length === 0) {
            // Show raw data summary if no structured signatures found
            if (Object.keys(fullData).length > 0) {
                const item = document.createElement('div');
                item.className = 'signature-item';
                item.innerHTML = `
                    <div class="signature-header">
                        <div class="sig-status-badge indeterminate">Info</div>
                        <div class="sig-info">
                            <span class="sig-name">API-Antwort</span>
                            <span class="sig-meta">Details in der JSON-Ansicht verfügbar</span>
                        </div>
                    </div>
                `;
                signaturesList.appendChild(item);
            }
            return;
        }

        signatures.forEach((sig, index) => {
            const status = getSignatureStatus(sig);
            const signerName = sig.signerName || sig.signedBy || sig.subjectDN || sig.certificateHolder || sig.signer || `Signatur ${index + 1}`;
            const signingTime = sig.signingTime || sig.signatureDate || sig.claimedSigningTime || sig.dateTime || '';
            const signatureType = sig.signatureType || sig.type || sig.signatureFormat || sig.format || '';
            const signatureLevel = sig.signatureLevel || sig.level || sig.qualificationLevel || '';
            const issuer = sig.issuer || sig.issuerDN || sig.certificateIssuer || '';
            const subIndication = sig.subIndication || sig.subStatus || sig.reason || '';

            const item = document.createElement('div');
            item.className = 'signature-item';

            const statusLabels = {
                valid: 'Gültig',
                invalid: 'Ungültig',
                warning: 'Warnung',
                indeterminate: 'Unbestimmt'
            };

            item.innerHTML = `
                <div class="signature-header" onclick="this.parentElement.querySelector('.signature-details').classList.toggle('open'); this.querySelector('.sig-expand').classList.toggle('expanded')">
                    <div class="sig-status-badge ${status}">${statusLabels[status] || status}</div>
                    <div class="sig-info">
                        <span class="sig-name">${escapeHtml(String(signerName))}</span>
                        ${signingTime ? `<span class="sig-meta">${escapeHtml(formatDate(signingTime))}</span>` : ''}
                    </div>
                    <svg class="sig-expand" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <div class="signature-details">
                    <div class="detail-grid">
                        ${signerName ? `<div class="detail-item"><span class="detail-label">Unterzeichner</span><span class="detail-value">${escapeHtml(String(signerName))}</span></div>` : ''}
                        ${signatureType ? `<div class="detail-item"><span class="detail-label">Signaturtyp</span><span class="detail-value">${escapeHtml(String(signatureType))}</span></div>` : ''}
                        ${signatureLevel ? `<div class="detail-item"><span class="detail-label">Signaturlevel</span><span class="detail-value">${escapeHtml(String(signatureLevel))}</span></div>` : ''}
                        ${issuer ? `<div class="detail-item"><span class="detail-label">Aussteller</span><span class="detail-value">${escapeHtml(String(issuer))}</span></div>` : ''}
                        ${signingTime ? `<div class="detail-item"><span class="detail-label">Zeitpunkt</span><span class="detail-value">${escapeHtml(formatDate(signingTime))}</span></div>` : ''}
                        ${subIndication ? `<div class="detail-item"><span class="detail-label">Details</span><span class="detail-value">${escapeHtml(String(subIndication))}</span></div>` : ''}
                        ${renderExtraDetails(sig)}
                    </div>
                </div>
            `;
            signaturesList.appendChild(item);
        });
    }

    function renderExtraDetails(sig) {
        const knownKeys = new Set([
            'indication', 'status', 'signatureStatus', 'validationStatus',
            'signerName', 'signedBy', 'subjectDN', 'certificateHolder', 'signer',
            'signingTime', 'signatureDate', 'claimedSigningTime', 'dateTime',
            'signatureType', 'type', 'signatureFormat', 'format',
            'signatureLevel', 'level', 'qualificationLevel',
            'issuer', 'issuerDN', 'certificateIssuer',
            'subIndication', 'subStatus', 'reason'
        ]);

        let html = '';
        for (const [key, value] of Object.entries(sig)) {
            if (knownKeys.has(key) || value === null || value === undefined) continue;
            if (typeof value === 'object') continue;
            html += `<div class="detail-item"><span class="detail-label">${escapeHtml(key)}</span><span class="detail-value">${escapeHtml(String(value))}</span></div>`;
        }
        return html;
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

    retryBtn.addEventListener('click', () => {
        resetToUpload();
    });

    newValidation.addEventListener('click', () => {
        resetToUpload();
    });

    function resetToUpload() {
        selectedFile = null;
        fileInput.value = '';
        uploadZone.classList.remove('hidden');
        fileSelected.classList.add('hidden');
        errorCard.classList.add('hidden');
        resultsCard.classList.add('hidden');
        loadingCard.classList.add('hidden');
        uploadCard.classList.remove('hidden');
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
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
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

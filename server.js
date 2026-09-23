const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
require('dotenv').config();

const {
    testConnection,
    incrementCallerAttempt,
    markCallerDiverted,
    deleteAttemptsForDate
} = require('./config/database');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = Number(process.env.PORT || 9569);
const HOST = process.env.HOST || '0.0.0.0';
const config = {
    maxAttempts: Number(process.env.CAMPAIGN_MAX_ATTEMPTS || 3),
    timeZone: process.env.CAMPAIGN_DIVERSION_TZ || 'Asia/Kolkata',
    cleanupTime: process.env.CLEANUP_TIME || '23:59',
    campaignUrl: process.env.CAMPAIGN_API_URL,
    apiKey: process.env.CAMPAIGN_API_KEY,
    accountId: process.env.CAMPAIGN_ACCOUNT_ID,
    leadPriority: Number(process.env.CAMPAIGN_LEAD_PRIORITY || 1),
    // IVR_ROUTING (extension 4025): Time of Day -> office9630/afterhours.
    allowedCallflowId: process.env.ALLOWED_CALLFLOW_ID || 'ca353d42f00b71a640ed052dc5a28c47'
};

function localTime(date = new Date()) {
    const values = new Intl.DateTimeFormat('en-CA', {
        timeZone: config.timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).reduce((result, part) => {
        result[part.type] = part.value;
        return result;
    }, {});

    return {
        date: `${values.year}-${values.month}-${values.day}`,
        minutes: Number(values.hour) * 60 + Number(values.minute)
    };
}

function allowedResponse() {
    return { module: 'callflow', data: { id: config.allowedCallflowId } };
}

function actionForAttempt(attemptCount, maxAttempts = config.maxAttempts) {
    if (attemptCount <= maxAttempts) return 'allow';
    if (attemptCount === maxAttempts + 1) return 'campaign_and_hangup';
    return 'hangup';
}

function campaignPayload(lead) {
    return {
        number: lead.phoneNumber,
        first_name: lead.firstName,
        last_name: lead.lastName,
        priority: lead.priority,
        ticket_id: lead.ticketId
    };
}

function extractPhoneNumber(req) {
    const requestData = { ...req.query, ...req.body };
    const acceptedKeys = [
        'phone_number',
        'From',
        'Caller-ID-Number',
        'CallerNumber',
        'caller_id_number'
    ];

    for (const key of acceptedKeys) {
        const value = requestData[key];
        if (value !== undefined && value !== null && String(value).trim()) {
            return String(value).trim();
        }
    }

    return '';
}

async function addNumberToCampaign(lead) {
    const payload = campaignPayload(lead);

    const response = await fetch(config.campaignUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': config.apiKey,
            'X-Account-ID': config.accountId
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
        throw new Error(`Campaign API returned ${response.status}: ${await response.text()}`);
    }
}

async function checkFrequency(req, res) {
    const phoneNumber = extractPhoneNumber(req);
    const requestData = { ...req.query, ...req.body };
    const callId = String(requestData['Call-ID'] || requestData.CallSid || 'unknown');
    const receivedKeys = Object.keys(requestData);

    console.log('[Pivot] incoming request', {
        method: req.method,
        path: req.originalUrl.split('?')[0],
        contentType: req.get('content-type') || 'not-set',
        callId,
        phoneNumber: phoneNumber || 'missing',
        receivedKeys
    });

    if (!phoneNumber) {
        console.warn('[Pivot] rejected request: caller number was not found');
        return res.status(400).json({ error: 'phone_number is required' });
    }

    const lead = {
        phoneNumber,
        firstName: String(requestData.first_name || ''),
        lastName: String(requestData.last_name || ''),
        priority: Number(requestData.priority || config.leadPriority),
        ticketId: String(requestData.prospect_id || requestData.ticket_id || '')
    };

    try {
        const now = localTime();
        const attemptCount = await incrementCallerAttempt(phoneNumber, now.date);
        const action = actionForAttempt(attemptCount);

        console.log('[Pivot] decision', {
            callId,
            phoneNumber,
            attemptCount,
            action,
            callflowId: action === 'allow' ? config.allowedCallflowId : undefined
        });

        if (action === 'allow') {
            return res.json(allowedResponse());
        }

        if (action === 'campaign_and_hangup') {
            try {
                await addNumberToCampaign(lead);
                await markCallerDiverted(phoneNumber, now.date);
            } catch (error) {
                console.error(`Failed to add ${phoneNumber} to campaign: ${error.message}`);
            }
        }

        return res.json({ module: 'hangup' });
    } catch (error) {
        console.error(`Frequency check failed for ${phoneNumber}: ${error.message}`);
        return res.status(500).json({ module: 'hangup' });
    }
}

app.all('/check_frequency', checkFrequency);
app.all('/check_language', checkFrequency); // Existing PBX URL compatibility.

// Attempt counts reset per call_date, but the row itself is removed once the
// day is over so no stale numbers linger in caller_frequency_tracking.
let lastCleanupDate = null;

function scheduleDailyCleanup() {
    const [cleanupHour, cleanupMinute] = config.cleanupTime.split(':').map(Number);

    setInterval(async () => {
        const now = localTime();
        const currentHour = Math.floor(now.minutes / 60);
        const currentMinute = now.minutes % 60;

        if (currentHour !== cleanupHour || currentMinute !== cleanupMinute) return;
        if (lastCleanupDate === now.date) return;

        lastCleanupDate = now.date;

        try {
            const deleted = await deleteAttemptsForDate(now.date);
            console.log(`[Cleanup] removed ${deleted} caller_frequency_tracking row(s) for ${now.date}`);
        } catch (error) {
            console.error(`[Cleanup] failed to remove rows for ${now.date}: ${error.message}`);
        }
    }, 60 * 1000);
}

async function start() {
    await testConnection();

    let server;
    try {
        server = https.createServer({
            key: fs.readFileSync('ssl/privkey.pem'),
            cert: fs.readFileSync('ssl/fullchain.pem')
        }, app);
    } catch (_) {
        server = http.createServer(app);
    }

    scheduleDailyCleanup();

    server.listen(PORT, HOST, () => {
        console.log(`Caller frequency service listening on ${HOST}:${PORT}`);
    });
}

if (require.main === module) {
    start().catch(error => {
        console.error('Unable to start:', {
            code: error.code,
            errno: error.errno,
            sqlState: error.sqlState,
            message: error.message || 'Database connection failed'
        });
        process.exit(1);
    });
}

module.exports = {
    actionForAttempt,
    campaignPayload,
    extractPhoneNumber,
    addNumberToCampaign,
    localTime
};

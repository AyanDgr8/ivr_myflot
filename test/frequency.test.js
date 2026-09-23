const assert = require('node:assert/strict');
const test = require('node:test');

test('attempts 1 through 3 are allowed', () => {
    const { actionForAttempt } = require('../server');

    assert.equal(actionForAttempt(1, 3), 'allow');
    assert.equal(actionForAttempt(2, 3), 'allow');
    assert.equal(actionForAttempt(3, 3), 'allow');
});

test('attempt 4 uploads to campaign and hangs up', () => {
    const { actionForAttempt } = require('../server');
    assert.equal(actionForAttempt(4, 3), 'campaign_and_hangup');
});

test('attempt 5 and later hang up without another upload', () => {
    const { actionForAttempt } = require('../server');

    assert.equal(actionForAttempt(5, 3), 'hangup');
    assert.equal(actionForAttempt(20, 3), 'hangup');
});

test('campaign payload uses the required field names', () => {
    const { campaignPayload } = require('../server');

    assert.deepEqual(campaignPayload({
        phoneNumber: '+971500000001',
        firstName: 'Test',
        lastName: 'Caller',
        priority: 2,
        ticketId: 'prospect-123'
    }), {
        number: '+971500000001',
        first_name: 'Test',
        last_name: 'Caller',
        priority: 2,
        ticket_id: 'prospect-123'
    });
});

test('caller number is accepted from common Kazoo field names', () => {
    const { extractPhoneNumber } = require('../server');

    assert.equal(extractPhoneNumber({ query: { From: '+971500000001' }, body: {} }), '+971500000001');
    assert.equal(extractPhoneNumber({ query: {}, body: { 'Caller-ID-Number': '971500000002' } }), '971500000002');
    assert.equal(extractPhoneNumber({ query: {}, body: { CallerNumber: '971500000003' } }), '971500000003');
    assert.equal(extractPhoneNumber({ query: {}, body: {} }), '');
});

test('campaign upload sends POST, required headers, and required JSON', async () => {
    let captured;
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
        captured = { url, ...options };
        return { ok: true, status: 200 };
    };

    process.env.CAMPAIGN_API_URL = 'https://campaign.test/api/v2/config/campaigns/test/lead';
    process.env.CAMPAIGN_API_KEY = 'test-api-key';
    process.env.CAMPAIGN_ACCOUNT_ID = 'test-account-id';
    delete require.cache[require.resolve('../server')];

    try {
        const { addNumberToCampaign } = require('../server');
        await addNumberToCampaign({
            phoneNumber: '+971500000001',
            firstName: 'Test',
            lastName: 'Caller',
            priority: 1,
            ticketId: 'ticket-1'
        });

        assert.equal(captured.url, 'https://campaign.test/api/v2/config/campaigns/test/lead');
        assert.equal(captured.method, 'POST');
        assert.equal(captured.headers['X-API-Key'], 'test-api-key');
        assert.equal(captured.headers['X-Account-ID'], 'test-account-id');
        assert.equal(captured.headers['Content-Type'], 'application/json');
        assert.deepEqual(JSON.parse(captured.body), {
            number: '+971500000001',
            first_name: 'Test',
            last_name: 'Caller',
            priority: 1,
            ticket_id: 'ticket-1'
        });
    } finally {
        global.fetch = originalFetch;
    }
});

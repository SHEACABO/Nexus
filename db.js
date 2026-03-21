/**
 * Nexus AI - PostgreSQL Database Layer
 * Replaces all in-memory arrays with persistent storage
 * Set DATABASE_URL in Railway environment variables
 */

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// ─── Schema ────────────────────────────────────────────────────────────────

async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                priority TEXT DEFAULT 'medium',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS leads (
                id TEXT PRIMARY KEY,
                name TEXT DEFAULT '',
                email TEXT NOT NULL,
                company TEXT DEFAULT '',
                industry TEXT DEFAULT '',
                title TEXT DEFAULT '',
                phone TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                linkedin TEXT DEFAULT '',
                status TEXT DEFAULT 'new',
                source TEXT DEFAULT 'manual',
                deal_value NUMERIC DEFAULT 0,
                interested_tier TEXT DEFAULT '',
                opportunity_notes TEXT DEFAULT '',
                sent_followup1 BOOLEAN DEFAULT FALSE,
                sent_followup2 BOOLEAN DEFAULT FALSE,
                sequence_id TEXT DEFAULT '',
                last_contacted TIMESTAMPTZ,
                replied_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS clients (
                id TEXT PRIMARY KEY,
                lead_id TEXT,
                name TEXT DEFAULT '',
                email TEXT NOT NULL,
                company TEXT DEFAULT '',
                package TEXT DEFAULT 'starter',
                status TEXT DEFAULT 'sample',
                leads_promised INT DEFAULT 0,
                leads_delivered INT DEFAULT 0,
                sample_delivered BOOLEAN DEFAULT FALSE,
                monthly_value NUMERIC DEFAULT 0,
                service_tier TEXT DEFAULT '',
                target_industry TEXT DEFAULT '',
                target_location TEXT DEFAULT '',
                paid_at TIMESTAMPTZ,
                converted_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS client_leads (
                id TEXT PRIMARY KEY,
                client_id TEXT NOT NULL,
                name TEXT DEFAULT '',
                email TEXT DEFAULT '',
                company TEXT DEFAULT '',
                title TEXT DEFAULT '',
                location TEXT DEFAULT '',
                linkedin TEXT DEFAULT '',
                source TEXT DEFAULT '',
                is_sample BOOLEAN DEFAULT FALSE,
                delivered_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS prospects (
                id TEXT PRIMARY KEY,
                name TEXT DEFAULT '',
                email TEXT DEFAULT '',
                company TEXT DEFAULT '',
                title TEXT DEFAULT '',
                location TEXT DEFAULT '',
                prospect_type TEXT DEFAULT '',
                status TEXT DEFAULT 'new',
                linkedin TEXT DEFAULT '',
                company_size TEXT DEFAULT '',
                found_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS campaigns (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                template TEXT DEFAULT 'cold-outreach',
                status TEXT DEFAULT 'active',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS campaign_leads (
                campaign_id TEXT NOT NULL,
                lead_id TEXT NOT NULL,
                PRIMARY KEY (campaign_id, lead_id)
            );

            CREATE TABLE IF NOT EXISTS email_queue (
                id TEXT PRIMARY KEY,
                lead_id TEXT NOT NULL,
                template TEXT NOT NULL,
                type TEXT NOT NULL,
                scheduled_time TIMESTAMPTZ NOT NULL,
                sent BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS email_accounts (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                smtp TEXT NOT NULL,
                imap TEXT NOT NULL,
                password TEXT NOT NULL,
                status TEXT DEFAULT 'active',
                daily_limit INT DEFAULT 30,
                daily_sent INT DEFAULT 0,
                warmup_started TIMESTAMPTZ DEFAULT NOW(),
                warmup_phase INT DEFAULT 1,
                health_score INT DEFAULT 100,
                total_sent INT DEFAULT 0,
                bounces INT DEFAULT 0,
                replies INT DEFAULT 0,
                last_reset TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS campaign_stats (
                id INT PRIMARY KEY DEFAULT 1,
                sent INT DEFAULT 0,
                replies INT DEFAULT 0,
                opportunities INT DEFAULT 0,
                leads_added INT DEFAULT 0,
                revenue NUMERIC DEFAULT 0,
                pipeline_value NUMERIC DEFAULT 0
            );

            INSERT INTO campaign_stats (id) VALUES (1) ON CONFLICT DO NOTHING;
        `);
        console.log('[DB] Schema ready');
    } finally {
        client.release();
    }
}

// ─── Tasks ─────────────────────────────────────────────────────────────────

async function getTasks() {
    const { rows } = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC');
    return rows.map(dbToTask);
}

async function createTask({ id, content, status = 'pending', priority = 'medium' }) {
    const { rows } = await pool.query(
        'INSERT INTO tasks (id, content, status, priority) VALUES ($1,$2,$3,$4) RETURNING *',
        [id, content, status, priority]
    );
    return dbToTask(rows[0]);
}

async function updateTask(id, status) {
    await pool.query('UPDATE tasks SET status=$1 WHERE id=$2', [status, id]);
}

async function deleteTask(id) {
    await pool.query('DELETE FROM tasks WHERE id=$1', [id]);
}

function dbToTask(row) {
    return {
        id: row.id,
        content: row.content,
        status: row.status,
        priority: row.priority,
        createdAt: row.created_at
    };
}

// ─── Leads ─────────────────────────────────────────────────────────────────

async function getLeads() {
    const { rows } = await pool.query('SELECT * FROM leads ORDER BY created_at DESC');
    return rows.map(dbToLead);
}

async function getLeadById(id) {
    const { rows } = await pool.query('SELECT * FROM leads WHERE id=$1', [id]);
    return rows[0] ? dbToLead(rows[0]) : null;
}

async function createLead(lead) {
    const { rows } = await pool.query(
        `INSERT INTO leads (id, name, email, company, industry, title, phone, notes, linkedin, status, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [lead.id, lead.name||'', lead.email, lead.company||'', lead.industry||'',
         lead.title||'', lead.phone||'', lead.notes||'', lead.linkedin||'',
         lead.status||'new', lead.source||'manual']
    );
    return dbToLead(rows[0]);
}

async function updateLead(id, fields) {
    const allowed = ['status','deal_value','interested_tier','opportunity_notes',
                     'sent_followup1','sent_followup2','sequence_id',
                     'last_contacted','replied_at','name','email','company'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [k, v] of Object.entries(fields)) {
        if (allowed.includes(k)) { sets.push(`${k}=$${i++}`); vals.push(v); }
    }
    if (sets.length === 0) return;
    vals.push(id);
    await pool.query(`UPDATE leads SET ${sets.join(',')} WHERE id=$${i}`, vals);
}

async function deleteLead(id) {
    await pool.query('DELETE FROM leads WHERE id=$1', [id]);
}

async function importLeads(newLeads) {
    let added = 0, skipped = 0;
    for (const lead of newLeads) {
        if (!lead.email) { skipped++; continue; }
        const { rows } = await pool.query('SELECT id FROM leads WHERE LOWER(email)=LOWER($1)', [lead.email]);
        if (rows.length > 0) { skipped++; continue; }
        const id = Date.now().toString() + Math.random().toString(36).substr(2,9);
        await createLead({ id, ...lead, status: 'new' });
        added++;
    }
    return { added, skipped };
}

function dbToLead(row) {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        company: row.company,
        industry: row.industry,
        title: row.title,
        phone: row.phone,
        notes: row.notes,
        linkedin: row.linkedin,
        status: row.status,
        source: row.source,
        dealValue: parseFloat(row.deal_value) || 0,
        interestedTier: row.interested_tier,
        sentFollowup1: row.sent_followup1,
        sentFollowup2: row.sent_followup2,
        sequenceId: row.sequence_id,
        lastContacted: row.last_contacted,
        repliedAt: row.replied_at,
        createdAt: row.created_at
    };
}

// ─── Clients ────────────────────────────────────────────────────────────────

async function getClients() {
    const { rows } = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    return rows.map(dbToClient);
}

async function getClientById(id) {
    const { rows } = await pool.query('SELECT * FROM clients WHERE id=$1', [id]);
    return rows[0] ? dbToClient(rows[0]) : null;
}

async function createClient(client) {
    const { rows } = await pool.query(
        `INSERT INTO clients (id, lead_id, name, email, company, package, status,
         leads_promised, leads_delivered, sample_delivered, target_industry, target_location)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [client.id, client.leadId||null, client.name||'', client.email,
         client.company||'', client.package||'starter', client.status||'sample',
         client.leadsPromised||0, client.leadsDelivered||0, client.sampleDelivered||false,
         client.targetIndustry||'', client.targetLocation||'']
    );
    return dbToClient(rows[0]);
}

async function updateClient(id, fields) {
    const allowed = ['status','leads_delivered','sample_delivered','paid_at',
                     'converted_at','monthly_value','service_tier'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [k, v] of Object.entries(fields)) {
        if (allowed.includes(k)) { sets.push(`${k}=$${i++}`); vals.push(v); }
    }
    if (sets.length === 0) return;
    vals.push(id);
    await pool.query(`UPDATE clients SET ${sets.join(',')} WHERE id=$${i}`, vals);
}

function dbToClient(row) {
    return {
        id: row.id,
        leadId: row.lead_id,
        name: row.name,
        email: row.email,
        company: row.company,
        package: row.package,
        status: row.status,
        leadsPromised: row.leads_promised,
        leadsDelivered: row.leads_delivered,
        sampleDelivered: row.sample_delivered,
        monthlyValue: parseFloat(row.monthly_value) || 0,
        serviceTier: row.service_tier,
        targetIndustry: row.target_industry,
        targetLocation: row.target_location,
        paidAt: row.paid_at,
        convertedAt: row.converted_at,
        createdAt: row.created_at
    };
}

// ─── Client Leads ───────────────────────────────────────────────────────────

async function getClientLeads(clientId) {
    const { rows } = await pool.query(
        'SELECT * FROM client_leads WHERE client_id=$1 ORDER BY delivered_at DESC', [clientId]
    );
    return rows;
}

async function addClientLeads(leads) {
    for (const lead of leads) {
        await pool.query(
            `INSERT INTO client_leads (id, client_id, name, email, company, title, location, linkedin, source, is_sample)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
            [lead.id, lead.clientId, lead.name||'', lead.email||'', lead.company||'',
             lead.title||'', lead.location||'', lead.linkedin||'', lead.source||'', lead.isSample||false]
        );
    }
}

// ─── Prospects ──────────────────────────────────────────────────────────────

async function getProspects() {
    const { rows } = await pool.query('SELECT * FROM prospects ORDER BY found_at DESC');
    return rows.map(dbToProspect);
}

async function addProspects(prospects) {
    for (const p of prospects) {
        await pool.query(
            `INSERT INTO prospects (id, name, email, company, title, location, prospect_type, status, linkedin, company_size)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
            [p.id, p.name||'', p.email||'', p.company||'', p.title||'',
             p.location||'', p.prospectType||'', p.status||'new', p.linkedin||'', p.companySize||'']
        );
    }
}

async function updateProspect(id, status) {
    await pool.query('UPDATE prospects SET status=$1 WHERE id=$2', [status, id]);
}

function dbToProspect(row) {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        company: row.company,
        title: row.title,
        location: row.location,
        prospectType: row.prospect_type,
        status: row.status,
        linkedin: row.linkedin,
        companySize: row.company_size,
        foundAt: row.found_at
    };
}

// ─── Campaigns ──────────────────────────────────────────────────────────────

async function getCampaigns() {
    const { rows } = await pool.query('SELECT * FROM campaigns ORDER BY created_at DESC');
    return rows;
}

async function createCampaign({ id, name, template, leads: leadIds }) {
    await pool.query(
        'INSERT INTO campaigns (id, name, template) VALUES ($1,$2,$3)',
        [id, name, template || 'cold-outreach']
    );
    for (const leadId of (leadIds || [])) {
        await pool.query(
            'INSERT INTO campaign_leads (campaign_id, lead_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [id, leadId]
        );
    }
}

// ─── Email Queue ────────────────────────────────────────────────────────────

async function getEmailQueue() {
    const { rows } = await pool.query('SELECT * FROM email_queue ORDER BY scheduled_time ASC');
    return rows.map(r => ({
        id: r.id,
        leadId: r.lead_id,
        template: r.template,
        type: r.type,
        scheduledTime: r.scheduled_time,
        sent: r.sent
    }));
}

async function addToQueue(job) {
    const existing = await pool.query(
        'SELECT id FROM email_queue WHERE lead_id=$1 AND type=$2 AND sent=FALSE',
        [job.leadId, job.type]
    );
    if (existing.rows.length > 0) return;
    await pool.query(
        'INSERT INTO email_queue (id, lead_id, template, type, scheduled_time) VALUES ($1,$2,$3,$4,$5)',
        [job.id || Date.now().toString(), job.leadId, job.template, job.type, job.scheduledTime]
    );
}

async function markQueueItemSent(id) {
    await pool.query('UPDATE email_queue SET sent=TRUE WHERE id=$1', [id]);
}

async function removeLeadFromQueue(leadId) {
    await pool.query('DELETE FROM email_queue WHERE lead_id=$1 AND sent=FALSE', [leadId]);
}

// ─── Email Accounts ─────────────────────────────────────────────────────────

async function getEmailAccounts() {
    const { rows } = await pool.query('SELECT * FROM email_accounts ORDER BY id');
    if (rows.length === 0) return [];
    return rows.map(dbToAccount);
}

async function upsertEmailAccount(account) {
    await pool.query(
        `INSERT INTO email_accounts (id, email, smtp, imap, password, status, daily_limit, daily_sent,
         warmup_started, warmup_phase, health_score, total_sent, bounces, replies, last_reset)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO UPDATE SET
         status=EXCLUDED.status, daily_limit=EXCLUDED.daily_limit,
         daily_sent=EXCLUDED.daily_sent, warmup_phase=EXCLUDED.warmup_phase,
         health_score=EXCLUDED.health_score, total_sent=EXCLUDED.total_sent,
         bounces=EXCLUDED.bounces, replies=EXCLUDED.replies, last_reset=EXCLUDED.last_reset`,
        [account.id, account.email, account.smtp, account.imap, account.password,
         account.status, account.dailyLimit, account.dailySent, account.warmupStarted,
         account.warmupPhase, account.healthScore, account.totalSent,
         account.bounces, account.replies, account.lastReset]
    );
}

function dbToAccount(row) {
    return {
        id: row.id,
        email: row.email,
        smtp: row.smtp,
        imap: row.imap,
        password: row.password,
        status: row.status,
        dailyLimit: row.daily_limit,
        dailySent: row.daily_sent,
        warmupStarted: row.warmup_started,
        warmupPhase: row.warmup_phase,
        healthScore: row.health_score,
        totalSent: row.total_sent,
        bounces: row.bounces,
        replies: row.replies,
        lastReset: row.last_reset
    };
}

// ─── Campaign Stats ──────────────────────────────────────────────────────────

async function getCampaignStats() {
    const { rows } = await pool.query('SELECT * FROM campaign_stats WHERE id=1');
    const r = rows[0];
    return {
        sent: r.sent, replies: r.replies, opportunities: r.opportunities,
        leadsAdded: r.leads_added, revenue: parseFloat(r.revenue),
        pipelineValue: parseFloat(r.pipeline_value)
    };
}

async function incrementStat(field, amount = 1) {
    const colMap = {
        sent: 'sent', replies: 'replies', opportunities: 'opportunities',
        leadsAdded: 'leads_added', revenue: 'revenue', pipelineValue: 'pipeline_value'
    };
    const col = colMap[field];
    if (!col) return;
    await pool.query(`UPDATE campaign_stats SET ${col}=${col}+$1 WHERE id=1`, [amount]);
}

// ─── Daily Sent Counter (in-memory is fine — resets daily anyway) ────────────

let _dailySentCount = 0;
let _dailySentDate = new Date().toDateString();

function getDailySentCount() {
    const today = new Date().toDateString();
    if (_dailySentDate !== today) { _dailySentCount = 0; _dailySentDate = today; }
    return _dailySentCount;
}

function incrementDailySent() {
    getDailySentCount(); // trigger reset check
    _dailySentCount++;
}

module.exports = {
    pool,
    initDB,
    // Tasks
    getTasks, createTask, updateTask, deleteTask,
    // Leads
    getLeads, getLeadById, createLead, updateLead, deleteLead, importLeads,
    // Clients
    getClients, getClientById, createClient, updateClient,
    // Client leads
    getClientLeads, addClientLeads,
    // Prospects
    getProspects, addProspects, updateProspect,
    // Campaigns
    getCampaigns, createCampaign,
    // Email queue
    getEmailQueue, addToQueue, markQueueItemSent, removeLeadFromQueue,
    // Email accounts
    getEmailAccounts, upsertEmailAccount,
    // Stats
    getCampaignStats, incrementStat,
    // Daily counter
    getDailySentCount, incrementDailySent
};

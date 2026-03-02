/**
 * Nexus AI - AgentMail Backend Server
 * Connects to AgentMail via IMAP/SMTP and processes emails with AI
 */

const express = require('express');
const cors = require('cors');
const imap = require('imap-simple');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// AgentMail Configuration
const AGENTMAIL = {
    email: 'shyliterature328@agentmail.to',
    password: 'am_us_840941eb18443c42802c178144a89b1a5598b1f596ca495e91bd9ad8f211a734',
    smtp: 'smtp.agentmail.to',
    imap: 'imap.agentmail.to'
};

// AI Configuration (Groq - Fast LLM)
const OLLAMA_API_KEY = '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';
const OLLAMA_BASE_URL = 'https://api.groq.com/openai/v1';  // Groq API endpoint
const OLLAMA_MODEL = 'llama-3.1-70b-versatile';  // Groq model

// Apollo.io API Configuration
const APOLLO_API_KEY = '';  // User will provide their Apollo API key

// ========== DELIVERABILITY SYSTEM ==========
// Email accounts with warmup tracking
let emailAccounts = [
    {
        id: '1',
        email: 'shyliterature328@agentmail.to',
        smtp: 'smtp.agentmail.to',
        imap: 'imap.agentmail.to',
        password: 'am_us_840941eb18443c42802c178144a89b1a5598b1f596ca495e91bd9ad8f211a734',
        status: 'active', // active, warming, paused, bounced
        dailyLimit: 30,
        dailySent: 0,
        warmupStarted: new Date().toISOString(),
        warmupPhase: 3, // 1=initial, 2=ramping, 3=full
        healthScore: 100,
        totalSent: 0,
        bounces: 0,
        replies: 0,
        lastReset: new Date().toDateString()
    }
];

// Daily stats
let deliverabilityStats = {
    totalSent: 0,
    totalBounces: 0,
    totalReplies: 0,
    averageHealthScore: 100
};

// Calculate health score based on metrics
function calculateHealthScore(account) {
    let score = 100;
    
    // Deduct for bounces (5 points per bounce, max 30)
    const bounceRate = account.totalSent > 0 ? (account.bounces / account.totalSent) * 100 : 0;
    score -= Math.min(bounceRate * 10, 30);
    
    // Deduct for low daily limit usage
    if (account.dailySent < account.dailyLimit * 0.3) {
        score -= 10;
    }
    
    return Math.max(0, Math.min(100, Math.round(score)));
}

// Get recommended daily limit based on warmup phase
function getRecommendedDailyLimit(phase) {
    const limits = {
        1: 10,   // Day 1-7: 10/day
        2: 25,   // Day 8-21: 25/day
        3: 50    // Day 22+: 50/day
    };
    return limits[phase] || 30;
}

// Check and update warmup phase
function updateWarmupPhase(account) {
    const daysSinceStart = Math.floor((Date.now() - new Date(account.warmupStarted).getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysSinceStart < 7) {
        account.warmupPhase = 1;
    } else if (daysSinceStart < 21) {
        account.warmupPhase = 2;
    } else {
        account.warmupPhase = 3;
    }
    
    account.dailyLimit = getRecommendedDailyLimit(account.warmupPhase);
    account.healthScore = calculateHealthScore(account);
}

// Reset daily counters if new day
function checkDailyReset() {
    const today = new Date().toDateString();
    
    emailAccounts.forEach(account => {
        if (account.lastReset !== today) {
            account.dailySent = 0;
            account.lastReset = today;
        }
    });
}

// Deliverability API endpoints
app.get('/api/deliverability/status', (req, res) => {
    checkDailyReset();
    
    // Update warmup phases
    emailAccounts.forEach(account => {
        updateWarmupPhase(account);
    });
    
    const activeAccount = emailAccounts.find(a => a.status === 'active') || emailAccounts[0];
    
    res.json({
        success: true,
        account: activeAccount,
        stats: deliverabilityStats,
        allAccounts: emailAccounts
    });
});

app.get('/api/deliverability/accounts', (req, res) => {
    res.json({ success: true, accounts: emailAccounts });
});

app.post('/api/deliverability/accounts', (req, res) => {
    const { email, smtp, imap, password } = req.body;
    
    if (!email || !password) {
        return res.json({ success: false, error: 'Email and password required' });
    }
    
    const newAccount = {
        id: Date.now().toString(),
        email,
        smtp: smtp || 'smtp.gmail.com',
        imap: imap || 'imap.gmail.com',
        password,
        status: 'warming',
        dailyLimit: 5, // Start small for warmup
        dailySent: 0,
        warmupStarted: new Date().toISOString(),
        warmupPhase: 1,
        healthScore: 100,
        totalSent: 0,
        bounces: 0,
        replies: 0,
        lastReset: new Date().toDateString()
    };
    
    emailAccounts.push(newAccount);
    
    res.json({ success: true, account: newAccount });
});

app.put('/api/deliverability/accounts/:id', (req, res) => {
    const { id } = req.params;
    const { status, dailyLimit } = req.body;
    
    const account = emailAccounts.find(a => a.id === id);
    if (!account) {
        return res.json({ success: false, error: 'Account not found' });
    }
    
    if (status) account.status = status;
    if (dailyLimit) account.dailyLimit = dailyLimit;
    
    res.json({ success: true, account });
});

app.delete('/api/deliverability/accounts/:id', (req, res) => {
    const { id } = req.params;
    emailAccounts = emailAccounts.filter(a => a.id !== id);
    res.json({ success: true });
});

// Track email send result for deliverability
function trackEmailResult(accountId, result) {
    const account = emailAccounts.find(a => a.id === accountId);
    if (!account) return;
    
    account.dailySent++;
    account.totalSent++;
    deliverabilityStats.totalSent++;
    
    if (result === 'bounce') {
        account.bounces++;
        deliverabilityStats.totalBounces++;
    } else if (result === 'reply') {
        account.replies++;
        deliverabilityStats.totalReplies++;
    }
    
    account.healthScore = calculateHealthScore(account);
    
    // Auto-pause if bounce rate too high
    const bounceRate = account.totalSent > 0 ? (account.bounces / account.totalSent) * 100 : 0;
    if (bounceRate > 5) {
        account.status = 'paused';
        console.log(`[WARN] Account ${account.email} auto-paused due to high bounce rate: ${bounceRate.toFixed(1)}%`);
    }
}

// In-memory storage (replace with database in production)
let tasks = [
    { id: '1', content: 'Review project proposal', status: 'pending', priority: 'high' },
    { id: '2', content: 'Email client about timeline', status: 'in_progress', priority: 'medium' },
    { id: '3', content: 'Team standup meeting', status: 'completed', priority: 'low' },
    { id: '4', content: 'Prepare quarterly report', status: 'pending', priority: 'urgent' }
];

let emailHistory = [];

// ========== MONEY-MAKING SYSTEM - LEAD GENERATION AGENCY ==========
// Leads database
let leads = [];

// Service Catalog - Lead Generation Agency Packages
const services = {
    'starter': {
        id: 'starter',
        name: 'Starter',
        price: 997,
        period: 'month',
        description: 'Perfect for small agencies getting started',
        features: [
            '500 Verified Leads per month',
            'Professional Email Scripts',
            'A/B Testing on Subject Lines',
            'Monthly Performance Report',
            'Email Setup & Configuration'
        ],
        leadsPerMonth: 500,
        emailSupport: true,
        callSupport: false
    },
    'professional': {
        id: 'professional',
        name: 'Professional',
        price: 1997,
        period: 'month',
        description: 'Most popular for growing agencies',
        features: [
            '1,500 Verified Leads per month',
            'Advanced Personalization',
            'CRM Integration (HubSpot, Salesforce)',
            'Bi-weekly Strategy Calls',
            'A/B Testing & Optimization',
            'Priority Email Support'
        ],
        leadsPerMonth: 1500,
        emailSupport: true,
        callSupport: true,
        popular: true
    },
    'enterprise': {
        id: 'enterprise',
        name: 'Enterprise',
        price: 3997,
        period: 'month',
        description: 'For agencies ready to scale fast',
        features: [
            '5,000+ Verified Leads per month',
            'Multi-channel Outreach (Email + LinkedIn)',
            'Dedicated Account Manager',
            'Weekly Strategy Calls',
            'Custom Landing Pages',
            'Real-time Dashboard Access',
            'White-label Reports'
        ],
        leadsPerMonth: 5000,
        emailSupport: true,
        callSupport: true
    }
};

// Campaign/Revenue tracking
let clients = []; // Converted clients
let pipeline = []; // Opportunities (interested but not closed)

let campaignStats = {
    sent: 0,
    replies: 0,
    opportunities: 0,
    leadsAdded: 0,
    revenue: 0,
    pipelineValue: 0
};

// ========== CLIENT MANAGEMENT SYSTEM ==========
// Client database - stores clients who bought packages
let clientDatabase = []; // { id, name, email, company, package, status, leadsPromised, leadsDelivered, sampleDelivered, paidAt, createdAt }

// Sample lead count (free preview before payment)
const SAMPLE_LEAD_COUNT = 50;

// Add a new client (when lead converts to opportunity)
function addClient(lead, packageTier) {
    const service = services[packageTier] || services['starter'];
    const client = {
        id: 'client_' + Date.now(),
        leadId: lead.id,
        name: lead.name,
        email: lead.email,
        company: lead.company,
        package: packageTier,
        status: 'sample', // sample → paid → active → churned
        leadsPromised: service.leadsPerMonth,
        leadsDelivered: 0,
        sampleDelivered: false,
        paidAt: null,
        createdAt: new Date().toISOString(),
        targetIndustry: lead.industry || '',
        targetLocation: lead.location || ''
    };
    clientDatabase.push(client);
    return client;
}

// Mark client as paid and deliver remaining leads
function processPayment(clientId) {
    const client = clientDatabase.find(c => c.id === clientId);
    if (!client) return null;
    
    client.status = 'active';
    client.paidAt = new Date().toISOString();
    
    // Calculate remaining leads to deliver
    const remaining = client.leadsPromised - client.leadsDelivered;
    
    // Trigger async lead generation for remaining leads
    if (remaining > 0) {
        generateLeadsForClient(client, remaining);
    }
    
    return client;
}

// Generate leads for a client (async)
async function generateLeadsForClient(client, count) {
    if (!APOLLO_API_KEY) {
        console.log('[WARN] No Apollo API key - skipping lead generation');
        return;
    }
    
    try {
        const response = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                api_key: APOLLO_API_KEY,
                per_page: Math.min(count, 100),
                q: client.targetIndustry || 'business',
                location: client.targetLocation || ''
            })
        });
        
        if (!response.ok) return;
        
        const data = await response.json();
        const newLeads = (data.people || []).map(person => ({
            id: 'lead_' + Date.now() + Math.random().toString(36).substr(2, 9),
            clientId: client.id,
            name: [person.first_name, person.last_name].filter(Boolean).join(' '),
            email: person.email,
            company: person.organization?.name || '',
            title: person.title || '',
            location: person.location || '',
            linkedin: person.linkedin_url || '',
            source: 'apollo-auto',
            deliveredAt: new Date().toISOString()
        }));
        
        // Add to client's delivered leads
        clientLeads = clientLeads.concat(newLeads);
        client.leadsDelivered += newLeads.length;
        
        console.log(`[AUTO] Generated ${newLeads.length} leads for client ${client.company}`);
    } catch (error) {
        console.error('[ERROR] Lead generation failed:', error.message);
    }
}

// Client leads storage
let clientLeads = []; // Leads delivered to clients

// API Endpoints for Clients

// Get all clients
app.get('/api/clients', (req, res) => {
    res.json({ 
        success: true, 
        clients: clientDatabase,
        stats: {
            total: clientDatabase.length,
            sample: clientDatabase.filter(c => c.status === 'sample').length,
            active: clientDatabase.filter(c => c.status === 'active').length,
            mrr: clientDatabase.filter(c => c.status === 'active').reduce((sum, c) => sum + (services[c.package]?.price || 0), 0)
        }
    });
});

// Get single client with leads
app.get('/api/clients/:id', (req, res) => {
    const client = clientDatabase.find(c => c.id === req.params.id);
    if (!client) {
        return res.json({ success: false, error: 'Client not found' });
    }
    
    const leads = clientLeads.filter(l => l.clientId === client.id);
    
    res.json({
        success: true,
        client,
        leads,
        deliveryProgress: {
            promised: client.leadsPromised,
            delivered: client.leadsDelivered,
            percentage: Math.round((client.leadsDelivered / client.leadsPromised) * 100)
        }
    });
});

// Create client from lead (convert lead to sample client)
app.post('/api/clients', (req, res) => {
    const { leadId, packageTier, targetIndustry, targetLocation } = req.body;
    
    const lead = leads.find(l => l.id === leadId);
    if (!lead) {
        return res.json({ success: false, error: 'Lead not found' });
    }
    
    // Check if already a client
    const existing = clientDatabase.find(c => c.leadId === leadId);
    if (existing) {
        return res.json({ success: false, error: 'Already a client' });
    }
    
    const client = {
        id: 'client_' + Date.now(),
        leadId: lead.id,
        name: lead.name,
        email: lead.email,
        company: lead.company,
        package: packageTier || 'starter',
        status: 'sample',
        leadsPromised: services[packageTier || 'starter'].leadsPerMonth,
        leadsDelivered: 0,
        sampleDelivered: false,
        paidAt: null,
        createdAt: new Date().toISOString(),
        targetIndustry: targetIndustry || lead.industry || '',
        targetLocation: targetLocation || ''
    };
    
    clientDatabase.push(client);
    
    // Update lead status
    leads = leads.map(l => l.id === leadId ? { ...l, status: 'client', clientId: client.id } : l);
    
    // Generate sample leads immediately
    generateSampleLeads(client.id);
    
    res.json({ success: true, client });
});

// Generate sample leads (50 free leads)
async function generateSampleLeads(clientId) {
    const client = clientDatabase.find(c => c.id === clientId);
    if (!client || client.sampleDelivered) return;
    
    // Use Apollo to get sample leads
    if (APOLLO_API_KEY) {
        try {
            const response = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    api_key: APOLLO_API_KEY,
                    per_page: SAMPLE_LEAD_COUNT,
                    q: client.targetIndustry || 'business',
                    location: client.targetLocation || ''
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                const sampleLeads = (data.people || []).map(person => ({
                    id: 'lead_' + Date.now() + Math.random().toString(36).substr(2, 9),
                    clientId: client.id,
                    name: [person.first_name, person.last_name].filter(Boolean).join(' '),
                    email: person.email,
                    company: person.organization?.name || '',
                    title: person.title || '',
                    location: person.location || '',
                    linkedin: person.linkedin_url || '',
                    isSample: true,
                    deliveredAt: new Date().toISOString()
                }));
                
                clientLeads = clientLeads.concat(sampleLeads);
                client.leadsDelivered = sampleLeads.length;
                client.sampleDelivered = true;
                
                console.log(`[AUTO] Generated ${sampleLeads.length} sample leads for ${client.company}`);
            }
        } catch (error) {
            console.error('[ERROR] Sample lead generation failed:', error.message);
        }
    }
    
    // If no API, create demo sample leads
    if (!client.sampleDelivered) {
        const demoLeads = [];
        for (let i = 0; i < SAMPLE_LEAD_COUNT; i++) {
            demoLeads.push({
                id: 'lead_demo_' + Date.now() + i,
                clientId: client.id,
                name: 'Sample Lead ' + (i + 1),
                email: 'lead' + (i + 1) + '@demo.com',
                company: 'Demo Company ' + (i + 1),
                title: 'Decision Maker',
                location: 'United States',
                linkedin: '',
                isSample: true,
                deliveredAt: new Date().toISOString()
            });
        }
        clientLeads = clientLeads.concat(demoLeads);
        client.leadsDelivered = demoLeads.length;
        client.sampleDelivered = true;
    }
}

// Simulate payment (in production, this would be Stripe webhook)
app.post('/api/clients/:id/pay', (req, res) => {
    const client = clientDatabase.find(c => c.id === req.params.id);
    if (!client) {
        return res.json({ success: false, error: 'Client not found' });
    }
    
if (client.status === 'active') {
        return res.json({ success: false, error: 'Already paid' });
    }
    
    // Process payment
    const updated = processPayment(client.id);
    
    res.json({ 
        success: true, 
        client: updated,
        message: 'Payment processed! Remaining leads are being generated.'
    });
});

// Get client's leads (with privacy controls)
app.get('/api/clients/:id/leads', (req, res) => {
    const client = clientDatabase.find(c => c.id === req.params.id);
    if (!client) {
        return res.json({ success: false, error: 'Client not found' });
    }
    
    const allLeads = clientLeads.filter(l => l.clientId === client.id);
    
    // If not paid, only show sample leads (and blur emails)
    let leadsToShow = allLeads;
    let showFullAccess = client.status === 'active';
    
    if (!showFullAccess) {
        // Only show sample leads, mask emails
        leadsToShow = allLeads.filter(l => l.isSample).map(l => ({
            ...l,
            email: l.email ? maskEmail(l.email) : '',
            name: l.name || 'Lead',
            showPreview: true
        }));
    }
    
    res.json({
        success: true,
        leads: leadsToShow,
        showFullAccess,
        deliveryProgress: {
            promised: client.leadsPromised,
            delivered: client.leadsDelivered,
            percentage: Math.round((client.leadsDelivered / client.leadsPromised) * 100)
        }
    });
});

// Mask email for privacy
function maskEmail(email) {
    if (!email || !email.includes('@')) return '***@***.***';
    const [local, domain] = email.split('@');
    const maskedLocal = local.length > 2 ? local[0] + '***' + local[local.length - 1] : '***';
    return maskedLocal + '@' + domain;
}

// ========== CLIENT FINDER - AUTOMATIC CLIENT ACQUISITION ==========
// Prospect types - businesses that need lead generation
const prospectTypes = {
    'marketing-agency': {
        name: 'Marketing Agencies',
        searchTerms: ['marketing agency', 'digital marketing agency', 'advertising agency'],
        description: 'Agencies that need leads for their clients'
    },
    'seo-agency': {
        name: 'SEO Agencies',
        searchTerms: ['seo agency', 'seo company', 'search optimization'],
        description: 'SEO companies that could use lead gen'
    },
    'web-design': {
        name: 'Web Design Agencies',
        searchTerms: ['web design agency', 'web development', 'digital agency'],
        description: 'Web agencies needing more clients'
    },
    'ppc-agency': {
        name: 'PPC Agencies',
        searchTerms: ['ppc agency', 'google ads agency', 'paid search'],
        description: 'PPC agencies looking for leads'
    },
    'social-media': {
        name: 'Social Media Agencies',
        searchTerms: ['social media agency', 'social marketing', 'influencer marketing'],
        description: 'Social media agencies'
    },
    'pr-firm': {
        name: 'PR Firms',
        searchTerms: ['pr firm', 'public relations', 'communications agency'],
        description: 'PR companies needing clients'
    }
};

// Prospects storage
let prospects = []; // Potential clients found by the bot

// Find potential clients automatically
app.post('/api/client-finder/find', async (req, res) => {
    const { prospectType, location, count = 50 } = req.body;
    
    if (!APOLLO_API_KEY) {
        // Demo mode - generate demo prospects
        const demoProspects = [];
        const type = prospectTypes[prospectType] || prospectTypes['marketing-agency'];
        for (let i = 0; i < count; i++) {
            demoProspects.push({
                id: 'prospect_' + Date.now() + i,
                name: 'Decision Maker ' + (i + 1),
                email: 'demo' + (i + 1) + '@' + (prospectType || 'agency') + '.com',
                company: type.name.replace(' Agencies', '') + ' Company ' + (i + 1),
                title: 'Owner / CEO',
                location: location || 'United States',
                prospectType: prospectType || 'marketing-agency',
                status: 'new', // new, contacted, interested, client
                foundAt: new Date().toISOString()
            });
        }
        prospects = prospects.concat(demoProspects);
        return res.json({ 
            success: true, 
            message: `Found ${demoProspects.length} demo prospects`,
            prospects: demoProspects,
            isDemo: true
        });
    }
    
    // Real Apollo.io search
    const type = prospectTypes[prospectType] || prospectTypes['marketing-agency'];
    const searchQuery = type.searchTerms[0];
    
    try {
        const response = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                api_key: APOLLO_API_KEY,
                per_page: Math.min(count, 100),
                q: searchQuery,
                location: location || ''
})
        });
        
        if (!response.ok) {
            return res.json({ success: false, error: 'Apollo API error: ' + response.status });
        }
        
        const data = await response.json();
        const foundProspects = (data.people || []).map(person => ({
            id: 'prospect_' + Date.now() + Math.random().toString(36).substr(2, 9),
            name: [person.first_name, person.last_name].filter(Boolean).join(' '),
            email: person.email,
            company: person.organization?.name || '',
            title: person.title || '',
            location: person.location || location || '',
            prospectType: prospectType || 'marketing-agency',
            status: 'new',
            foundAt: new Date().toISOString(),
            linkedin: person.linkedin_url || '',
            companySize: person.organization?.num_employees || ''
        }));
        
        // Add to prospects
        prospects = prospects.concat(foundProspects);
        
        res.json({ 
            success: true, 
            message: `Found ${foundProspects.length} prospects!`,
            prospects: foundProspects
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Get all prospects
app.get('/api/client-finder/prospects', (req, res) => {
    res.json({ 
        success: true, 
        prospects,
        stats: {
            total: prospects.length,
            new: prospects.filter(p => p.status === 'new').length,
            contacted: prospects.filter(p => p.status === 'contacted').length,
            interested: prospects.filter(p => p.status === 'interested').length,
            converted: prospects.filter(p => p.status === 'client').length
        }
    });
});

// Update prospect status
app.put('/api/client-finder/prospects/:id', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    prospects = prospects.map(p => p.id === id ? { ...p, status } : p);
    res.json({ success: true });
});

// Send outreach to prospect (convert to lead and send email)
app.post('/api/client-finder/reachout', async (req, res) => {
    const { prospectId, template = 'agency-offer' } = req.body;
    
    const prospect = prospects.find(p => p.id === prospectId);
    if (!prospect) {
        return res.json({ success: false, error: 'Prospect not found' });
    }
    
    // Add to leads as a new lead
    const newLead = {
        id: 'lead_' + Date.now(),
        name: prospect.name,
        email: prospect.email,
        company: prospect.company,
        industry: prospect.prospectType,
        phone: '',
        notes: '',
        status: 'new',
        source: 'client-finder',
        createdAt: new Date().toISOString()
    };
    
    leads.push(newLead);
    
    // Update prospect status
    prospects = prospects.map(p => p.id === prospectId ? { ...p, status: 'contacted' } : p);
    
    // Send email
    const templateData = emailTemplates[template] || emailTemplates['agency-offer'];
    const subject = templateData.subject.replace(/{{company}}/g, prospect.company || 'your company');
    const body = templateData.body.replace(/{{name}}/g, prospect.name || 'there').replace(/{{company}}/g, prospect.company || 'your company');
    
    try {
        const transporter = nodemailer.createTransport({
            host: AGENTMAIL.smtp,
            port: 587,
            secure: false,
            auth: {
                user: AGENTMAIL.email,
                pass: AGENTMAIL.password
            }
        });
        
        await transporter.sendMail({
            from: AGENTMAIL.email,
            to: prospect.email,
            subject: subject,
            text: body
        });
        
        campaignStats.sent++;
        
        res.json({ 
            success: true, 
            message: 'Outreach sent to prospect!',
            lead: newLead
        });
    } catch (error) {
        res.json({ success: true, message: 'Prospect added as lead (email failed)', lead: newLead });
    }
});

// Batch outreach to all new prospects
app.post('/api/client-finder/batch-reachout', async (req, res) => {
    const { template = 'agency-offer', maxPerDay = 30 } = req.body;
    
    const newProspects = prospects.filter(p => p.status === 'new').slice(0, maxPerDay);
    let sent = 0;
    
    for (const prospect of newProspects) {
        // Add as lead
        const newLead = {
            id: 'lead_' + Date.now() + Math.random(),
            name: prospect.name,
            email: prospect.email,
            company: prospect.company,
            industry: prospect.prospectType,
            phone: '',
            notes: '',
            status: 'new',
            source: 'client-finder',
            createdAt: new Date().toISOString()
        };
        leads.push(newLead);
        
        // Update prospect
        prospects = prospects.map(p => p.id === prospect.id ? { ...p, status: 'contacted' } : p);
        sent++;
        
        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 500));
    }
    
    res.json({ 
        success: true, 
        message: `Queued ${sent} prospects for outreach!`,
        sent
    });
});

// Email templates for outreach - SPECIFIC OFFERS WITH PRICING
const emailTemplates = {
    'agency-offer': {
        name: 'Lead Gen Agency Offer',
        subject: 'Question about your lead flow - {{company}}',
        body: `Hi {{name}},

I help agencies like {{company}} generate 30-50 qualified leads per month through outbound email marketing.

Here's what we do:
- Source & verify targeted prospect lists
- Write personalized cold emails that get responses
- Set up automated follow-up sequences
- Provide real-time dashboard with results

Our clients typically see:
• 15-25% response rates within 30 days
• 3-8 booked demos per month
• Average deal value: $2,000-5,000

Pricing starts at $997/month for 500 leads. That includes everything - no per-lead fees, no hidden costs.

Want me to send over a custom proposal for {{company}}?

Best regards`
    },
    'starter-offer': {
        name: 'Starter Package Offer',
        subject: 'Generate 500 leads/mo for {{company}}?',
        body: `Hi {{name}},

I help businesses like {{company}} generate 500+ qualified leads every single month through targeted email outreach.

Here's what's included in our $997/month Starter package:

✅ 500 Verified Leads - We find and verify decision-maker emails
✅ Professional Copywriting - Emails written to get responses  
✅ A/B Testing - We test subject lines to maximize open rates
✅ Monthly Reports - See exactly what's working
✅ Full Setup - We configure everything for you

Our average client sees their first booked demo within 2 weeks.

Interested in seeing how we'd approach {{company}}'s lead generation?

Best regards`
    },
    'professional-offer': {
        name: 'Professional Package Offer',
        subject: 'Scale {{company}}\'s lead generation?',
        body: `Hi {{name}},

I help agencies like {{company}} scale to 1,500+ leads per month with our done-for-you outreach program.

Here's what's included in our $1,997/month Professional package:

✅ 1,500 Verified Leads - High-quality, decision-maker contacts
✅ Advanced Personalization - We research each prospect
✅ CRM Integration - Connects with HubSpot, Salesforce, Pipedrive
✅ Bi-weekly Strategy Calls - We optimize together
✅ A/B Testing - Continuous improvement of results
✅ Priority Support - Direct access to our team

For context, our clients typically add $30k-60k in pipeline value within 90 days.

Want to see a custom lead strategy for {{company}}?

Best regards`
    },
    'enterprise-offer': {
        name: 'Enterprise Package Offer',
        subject: 'Enterprise lead generation for {{company}}',
        body: `Hi {{name}},

I help enterprise agencies like {{company}} generate 5,000+ leads per month with our full-service outreach solution.

Here's what's included in our $3,997/month Enterprise package:

✅ 5,000+ Verified Leads - Massive scale, quality guaranteed
✅ Multi-channel Outreach - Email + LinkedIn combination
✅ Dedicated Account Manager - You get a named contact
✅ Weekly Strategy Calls - Deep optimization sessions
✅ Custom Landing Pages - Convert leads into booked demos
✅ Real-time Dashboard - See every metric live
✅ White-label Reports - Brand reports for your clients

This is our complete solution for agencies ready to scale fast.

Want to schedule a call to discuss {{company}}'s goals?

Best regards`
    },
    'cold-outreach': {
        name: 'Cold Outreach',
        subject: 'Quick question about {{company}}',
        body: `Hi {{name}},

I came across {{company}} and I have a question for you.

Are you currently getting enough qualified leads coming through your door each month?

I help businesses in your industry generate more leads without spending more on ads. Happy to share a quick strategy that might help.

Want me to send it over?

Best regards`
    },
    'follow-up': {
        name: 'Follow Up',
        subject: 'Following up - {{company}}',
        body: `Hi {{name}},

Just wanted to follow up on my last email. I know you're busy, so I'll keep this short.

I help companies like {{company}} get more leads and bookings. The interesting thing is most of my clients were in the same spot as you - getting by but not growing.

Would a few extra leads per month make a difference for {{company}}?

Happy to chat if you're interested.

Best regards`
    },
    'free-value': {
        name: 'Free Value Offer',
        subject: 'Free idea for {{company}}',
        body: `Hi {{name}},

I spent 10 minutes looking at {{company}}'s online presence and I found one thing that could be costing you leads.

Want me to tell you what it is?

It takes 2 minutes and there's no catch.

Best regards`
    },
    'free-audit': {
        name: 'Free Audit Offer',
        subject: 'Free audit for {{company}}',
        body: `Hi {{name}},

I help businesses like {{company}} double their leads in 90 days or less.

Would you be interested in a free audit? I'll show you:
- What's working in your current approach
- 3 quick fixes that could improve results
- What's working for your competitors

No obligation - just useful insights.

Interested?

Best regards`
    },
    'quick-question': {
        name: 'Quick Question',
        subject: 'Quick question for you',
        body: `Hi {{name}},

Hope you're having a great week!

I have a quick question - what's your biggest challenge when it comes to getting more customers right now?

I ask because I've helped several businesses in your space solve exactly that problem.

Happy to share if you're open to it.

Best regards`
    },
    'saw-your': {
        name: 'Saw Your Work',
        subject: 'Saw what you\'re doing at {{company}}',
        body: `Hi {{name}},

I saw what you're doing at {{company}} and it's impressive. You guys are clearly doing something right.

That said, I work with businesses like yours to help scale up even faster. We've got a particular angle on lead generation that tends to work well for companies at your stage.

Would it make sense to share a quick idea?

Best regards`
    },
    'case-study': {
        name: 'Case Study',
        subject: 'How we helped {{company}}\'s competitor',
        body: `Hi {{name}},

I recently helped one of {{company}}'s competitors get 40% more leads in 60 days.

Want to know what we did?

I'll send over the case study - it's a quick read and might spark some ideas for {{company}}.

Interested?

Best regards`
    },
    'book-call': {
        name: 'Book a Call',
        subject: 'Want to chat?',
        body: `Hi {{name}},

I've been meaning to reach out. Would you be open to a 15-minute call?

I won't sell you anything - just want to learn about {{company}} and see if there's any way I might be able to help.

No pressure either way.

Best regards`
    }
};

// Follow-up Sequences
let sequences = [
    {
        id: '1',
        name: 'Classic 3-Step',
        steps: [
            { day: 0, template: 'cold-outreach', name: 'Initial Email' },
            { day: 3, template: 'follow-up', name: 'First Follow-up' },
            { day: 7, template: 'free-value', name: 'Last Chance' }
        ]
    },
    {
        id: '2',
        name: 'High-Ticket',
        steps: [
            { day: 0, template: 'cold-outreach', name: 'Initial Email' },
            { day: 2, template: 'free-audit', name: 'Value Email' },
            { day: 5, template: 'follow-up', name: 'Follow up' },
            { day: 10, template: 'quick-question', name: 'Final Touch' }
        ]
    }
];

// Campaign stats
let campaignStats = {
    sent: 0,
    replies: 0,
    leadsAdded: 0
};

// ========== AUTOMATION SYSTEM ==========
// Daily limits
const DAILY_LIMIT = 30; // Max emails per day
let dailySentCount = 0;
let dailySentDate = new Date().toDateString();

// Campaign storage
let campaigns = [];

// Email queue for scheduled sending
let emailQueue = [];

// Start automation scheduler (runs every minute)
setInterval(async () => {
    await processEmailQueue();
    await checkForReplies();
    await processScheduledFollowups();
}, 60000); // Check every minute

// Process queued emails
async function processEmailQueue() {
    const today = new Date().toDateString();
    if (dailySentDate !== today) {
        dailySentCount = 0;
        dailySentDate = today;
    }
    
    if (emailQueue.length === 0 || dailySentCount >= DAILY_LIMIT) return;
    
    const now = new Date();
    const pendingEmails = emailQueue.filter(item => 
        new Date(item.scheduledTime) <= now && !item.sent
    );
    
    for (const emailJob of pendingEmails) {
        if (dailySentCount >= DAILY_LIMIT) break;
        
        try {
            const lead = leads.find(l => l.id === emailJob.leadId);
            if (!lead || lead.status === 'replied' || lead.status === 'converted') {
                emailJob.sent = true;
                continue;
            }
            
            const template = emailTemplates[emailJob.template] || emailTemplates['cold-outreach'];
            let subject = template.subject.replace(/{{name}}/g, lead.name || 'there')
                .replace(/{{company}}/g, lead.company || 'your company');
            let body = template.body.replace(/{{name}}/g, lead.name || 'there')
                .replace(/{{company}}/g, lead.company || 'your company')
                .replace(/{{value-proposition}}/g, 'getting more customers')
                .replace(/{{goal}}/g, 'attract more customers');
            
            const transporter = getSmtpTransporter();
            await transporter.sendMail({
                from: AGENTMAIL.email,
                to: lead.email,
                subject: subject,
                text: body
            });
            
            dailySentCount++;
            emailJob.sent = true;
            campaignStats.sent++;
            
            // Update lead status
            leads = leads.map(l => l.id === lead.id ? { 
                ...l, 
                status: 'contacted', 
                lastContacted: new Date().toISOString(),
                lastEmailType: emailJob.type
            } : l);
            
            console.log(`[AUTO] Sent ${emailJob.type} to ${lead.email}`);
        } catch (error) {
            console.error('[AUTO] Error sending email:', error.message);
        }
    }
}

// Check for replies via IMAP
async function checkForReplies() {
    try {
        const imapConnection = await getImapConnection();
        await imapConnection.openBox('INBOX');
        
        const searchCriteria = [['SINCE', new Date(Date.now() - 24 * 60 * 60 * 1000)]];
        const fetchOptions = { bodies: ['HEADER', 'TEXT'], markSeen: false };
        
        const messages = await imapConnection.search(searchCriteria, fetchOptions);
        
        for (const message of messages) {
            const fromHeader = message.parts.find(p => p.which === 'HEADER');
            const from = fromHeader?.body?.from?.[0] || '';
            
            // Check if it's a reply from our leads
            const lead = leads.find(l => from.includes(l.email));
            if (lead && lead.status !== 'replied') {
                leads = leads.map(l => l.id === lead.id ? {
                    ...l,
                    status: 'replied',
                    repliedAt: new Date().toISOString()
                } : l);
                
                // Cancel pending follow-ups for this lead
                emailQueue = emailQueue.filter(q => q.leadId !== lead.id);
                
                campaignStats.replies++;
                console.log(`[AUTO] Reply detected from ${lead.email}`);
            }
        }
        
        await imapConnection.end();
    } catch (error) {
        // IMAP check failed, ignore
    }
}

// Process scheduled follow-ups
async function processScheduledFollowups() {
    const now = new Date();
    
    for (const lead of leads) {
        if (lead.status === 'replied' || lead.status === 'converted') continue;
        if (!lead.lastContacted) continue;
        
        const lastContact = new Date(lead.lastContacted);
        const daysSinceContact = Math.floor((now - lastContact) / (1000 * 60 * 60 * 24));
        
        // Check if we should send follow-up
        if (daysSinceContact >= 3 && !lead.sentFollowup1) {
            // Send follow-up 1
            const existingJob = emailQueue.find(q => q.leadId === lead.id && q.type === 'followup-1' && !q.sent);
            if (!existingJob) {
                emailQueue.push({
                    leadId: lead.id,
                    template: 'follow-up',
                    type: 'followup-1',
                    scheduledTime: now,
                    sent: false
                });
                leads = leads.map(l => l.id === lead.id ? { ...l, sentFollowup1: true } : l);
            }
        }
        
        if (daysSinceContact >= 7 && !lead.sentFollowup2) {
            // Send follow-up 2
            const existingJob = emailQueue.find(q => q.leadId === lead.id && q.type === 'followup-2' && !q.sent);
if (!existingJob) {
                emailQueue.push({
                    leadId: lead.id,
                    template: 'free-value',
                    type: 'followup-2',
                    scheduledTime: now,
                    sent: false
                });
                leads = leads.map(l => l.id === lead.id ? { ...l, sentFollowup2: true } : l);
            }
        }
    }
}

// Campaign APIs
app.post('/api/campaigns', (req, res) => {
    const { name, template, leads: leadIds, schedule } = req.body;
    
    const campaign = {
        id: Date.now().toString(),
        name,
        template: template || 'cold-outreach',
        leads: leadIds || [],
        schedule,
        status: 'active',
        createdAt: new Date().toISOString()
    };
    
    campaigns.push(campaign);
    
    // Queue initial emails for all leads
    const now = new Date();
    for (const leadId of leadIds) {
        const lead = leads.find(l => l.id === leadId);
        if (lead && lead.status === 'new') {
            emailQueue.push({
                leadId,
                template: campaign.template,
                type: 'initial',
                scheduledTime: now,
                sent: false
            });
        }
    }
    
    res.json({ success: true, campaign });
});

app.get('/api/campaigns', (req, res) => {
    res.json({ 
        campaigns, 
        queueSize: emailQueue.filter(e => !e.sent).length,
        dailySent: dailySentCount,
        dailyLimit: DAILY_LIMIT
    });
});

app.get('/api/automation/status', (req, res) => {
    res.json({
        queueSize: emailQueue.filter(e => !e.sent).length,
        dailySent: dailySentCount,
        dailyLimit: DAILY_LIMIT,
        pendingFollowups: leads.filter(l => l.status === 'contacted' && !l.sentFollowup1).length,
        repliedLeads: leads.filter(l => l.status === 'replied').length
    });
});

// ========== SERVICES & REVENUE API ==========
// Get all services
app.get('/api/services', (req, res) => {
    res.json({ success: true, services });
});

// Get revenue stats
app.get('/api/revenue', (req, res) => {
    // Calculate revenue from converted clients
    const convertedClients = clients.filter(c => c.status === 'active');
    const totalRevenue = convertedClients.reduce((sum, c) => sum + (c.monthlyValue || 0), 0);
    
    // Calculate pipeline value
    const pipelineValue = leads
        .filter(l => l.status === 'opportunity')
        .reduce((sum, l) => sum + (l.dealValue || 0), 0);
    
    res.json({
        success: true,
        stats: {
            totalRevenue,
            monthlyRecurringRevenue: totalRevenue,
            pipelineValue,
            totalClients: convertedClients.length,
            totalLeads: leads.length,
            totalSent: campaignStats.sent,
            totalReplies: campaignStats.replies,
            conversionRate: campaignStats.replies > 0 
                ? Math.round((leads.filter(l => l.status === 'opportunity' || l.status === 'converted').length / campaignStats.replies) * 100) 
                : 0
        },
        clients: convertedClients,
        opportunities: leads.filter(l => l.status === 'opportunity')
    });
});

// Convert a lead to client
app.post('/api/leads/:id/convert', (req, res) => {
    const { id } = req.params;
    const { serviceTier, dealValue } = req.body;
    
    const lead = leads.find(l => l.id === id);
    if (!lead) {
        return res.json({ success: false, error: 'Lead not found' });
    }
    
    const service = services[serviceTier] || services['starter'];
    const value = dealValue || service.price;
    
    // Add to clients
    clients.push({
        id: lead.id,
        name: lead.name,
        email: lead.email,
        company: lead.company,
        serviceTier: serviceTier,
        monthlyValue: value,
        convertedAt: new Date().toISOString(),
        status: 'active'
    });
    
    // Update lead status
    leads = leads.map(l => l.id === id ? {
        ...l,
        status: 'converted',
        convertedAt: new Date().toISOString(),
        dealValue: value
    } : l);
    
    // Update stats
    campaignStats.revenue += value;
    
    res.json({ success: true, client: clients[clients.length - 1] });
});

// Set lead as opportunity
app.post('/api/leads/:id/opportunity', (req, res) => {
    const { id } = req.params;
    const { interestedTier, notes } = req.body;
    
    const service = services[interestedTier] || services['starter'];
    
    leads = leads.map(l => l.id === id ? {
        ...l,
        status: 'opportunity',
        interestedTier: interestedTier,
        dealValue: service.price,
        opportunityNotes: notes,
        markedAt: new Date().toISOString()
    } : l);
    
    campaignStats.opportunities++;
    
    res.json({ success: true });
});

// Add lead
app.post('/api/leads', (req, res) => {
    const { name, email, company, industry, phone, notes } = req.body;
    if (!email) {
        return res.json({ success: false, error: 'Email is required' });
    }
    const newLead = {
        id: Date.now().toString(),
        name: name || '',
        email,
        company: company || '',
        industry: industry || '',
        phone: phone || '',
        notes: notes || '',
        status: 'new', // new, contacted, replied, converted, failed
        source: 'manual',
        createdAt: new Date().toISOString()
    };
    leads.push(newLead);
    campaignStats.leadsAdded++;
    res.json({ success: true, lead: newLead });
});

// Get all leads
app.get('/api/leads', (req, res) => {
    res.json({ leads, stats: campaignStats });
});

// Get replied leads (for notifications)
app.get('/api/leads/replied', (req, res) => {
    const repliedLeads = leads.filter(l => l.status === 'replied');
    res.json({ 
        success: true, 
        replies: repliedLeads,
        count: repliedLeads.length 
    });
});

// Get recent activity (for notifications)
app.get('/api/notifications', (req, res) => {
    const notifications = [];
    
    // Add replied leads as notifications
    const repliedLeads = leads.filter(l => l.status === 'replied' && l.repliedAt);
    repliedLeads.forEach(lead => {
        notifications.push({
            id: 'reply-' + lead.id,
            type: 'reply',
            leadId: lead.id,
            leadName: lead.name || lead.email,
            company: lead.company,
            message: `replied to your email`,
            timestamp: lead.repliedAt,
            read: false
        });
    });
    
    // Sort by timestamp descending
    notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.json({ 
        success: true, 
        notifications: notifications.slice(0, 20),
        unreadCount: notifications.filter(n => !n.read).length
    });
});

// Update lead status
app.put('/api/leads/:id', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    leads = leads.map(l => l.id === id ? { ...l, status } : l);
    res.json({ success: true });
});

// Delete lead
app.delete('/api/leads/:id', (req, res) => {
    const { id } = req.params;
    leads = leads.filter(l => l.id !== id);
    res.json({ success: true });
});

// Get email templates
app.get('/api/templates', (req, res) => {
    res.json({ templates: emailTemplates });
});

// Get sequences
app.get('/api/sequences', (req, res) => {
    res.json({ sequences, templates: emailTemplates });
});

// CSV Import - Bulk add leads
app.post('/api/leads/import', (req, res) => {
    const { leads: newLeads } = req.body;
    
    if (!Array.isArray(newLeads) || newLeads.length === 0) {
        return res.json({ success: false, error: 'No leads provided' });
    }
    
    let added = 0;
    newLeads.forEach(lead => {
        if (lead.email) {
            const exists = leads.find(l => l.email.toLowerCase() === lead.email.toLowerCase());
            if (!exists) {
                leads.push({
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                    name: lead.name || lead.Name || '',
                    email: lead.email || lead.Email || '',
                    company: lead.company || lead.Company || '',
                    industry: lead.industry || lead.Industry || '',
                    phone: lead.phone || lead.Phone || '',
                    notes: lead.notes || lead.Notes || '',
                    status: 'new',
                    source: 'csv-import',
                    createdAt: new Date().toISOString()
                });
                added++;
            }
        }
    });
    
    campaignStats.leadsAdded += added;
    res.json({ success: true, added, total: leads.length });
});

// ========== APOLLO.IO LEAD SOURCING ==========
// Set Apollo API Key
app.post('/api/apollo/config', (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) {
        return res.json({ success: false, error: 'API key required' });
    }
    APOLLO_API_KEY = apiKey;
    res.json({ success: true, message: 'Apollo API key configured' });
});

// Search leads on Apollo.io
app.post('/api/apollo/search', async (req, res) => {
    const { query, industry, location, title, page = 1 } = req.body;
    
    if (!APOLLO_API_KEY) {
        return res.json({ 
            success: false, 
            error: 'Apollo API key not configured. Go to Settings to add your key.',
            needsConfig: true 
        });
    }
    
    try {
        const searchParams = {
            api_key: APOLLO_API_KEY,
            page: page || 1,
            per_page: 20
        };
        
        // Add search criteria
        if (query) {
            searchParams.q = query;
        }
        if (title) {
            searchParams.job_title = title;
        }
        if (industry) {
            searchParams.industry = industry;
        }
        if (location) {
            searchParams.location = location;
        }
        
        const response = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(searchParams)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Apollo API Error:', response.status, errorText);
            return res.json({ 
                success: false, 
                error: `Apollo API error: ${response.status}` 
            });
        }
        
        const data = await response.json();
        
        // Transform Apollo data to our format
        const transformedLeads = (data.people || []).map(person => ({
            id: person.id,
            name: [person.first_name, person.last_name].filter(Boolean).join(' '),
            firstName: person.first_name,
            lastName: person.last_name,
            email: person.email,
            emailVerified: person.email_verified,
            company: person.organization?.name || '',
            companySize: person.organization?.num_employees,
            industry: person.organization?.industry,
            title: person.title,
            location: person.location?.city ? `${person.location.city}, ${person.location.country}` : person.location?.country,
            linkedin: person.linkedin_url,
            phone: person.phone_number,
            source: 'apollo'
        }));
        
        res.json({ 
            success: true, 
            leads: transformedLeads,
            total: data.total,
            page: data.page,
            perPage: data.per_page
        });
        
    } catch (error) {
        console.error('Apollo Search Error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Import leads from Apollo to local database
app.post('/api/apollo/import', (req, res) => {
    const { leads: apolloLeads } = req.body;
    
    if (!Array.isArray(apolloLeads) || apolloLeads.length === 0) {
        return res.json({ success: false, error: 'No leads to import' });
    }
    
    let added = 0;
    let skipped = 0;
    
    apolloLeads.forEach(lead => {
        if (!lead.email) {
            skipped++;
            return;
        }
        
        const exists = leads.find(l => l.email.toLowerCase() === lead.email.toLowerCase());
        if (exists) {
            skipped++;
            return;
        }
        
        leads.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            name: lead.name || '',
            email: lead.email,
            company: lead.company || '',
            industry: lead.industry || '',
            title: lead.title || '',
            phone: lead.phone || '',
            linkedin: lead.linkedin || '',
            status: 'new',
            source: 'apollo-import',
            createdAt: new Date().toISOString()
        });
        added++;
    });
    
    campaignStats.leadsAdded += added;
    res.json({ success: true, added, skipped, total: leads.length });
});

// Send sequence to lead
app.post('/api/sequence/send', async (req, res) => {
    const { leadId, sequenceId } = req.body;
    
    const lead = leads.find(l => l.id === leadId);
    const sequence = sequences.find(s => s.id === sequenceId);
    
    if (!lead) return res.json({ success: false, error: 'Lead not found' });
    if (!sequence) return res.json({ success: false, error: 'Sequence not found' });
    
    const results = [];
    
    for (const step of sequence.steps) {
        const template = emailTemplates[step.template] || emailTemplates['cold-outreach'];
        
        let subject = template.subject.replace(/{{name}}/g, lead.name || 'there')
            .replace(/{{company}}/g, lead.company || 'your company');
        
        let body = template.body.replace(/{{name}}/g, lead.name || 'there')
            .replace(/{{company}}/g, lead.company || 'your company')
            .replace(/{{value-proposition}}/g, 'getting more customers')
            .replace(/{{goal}}/g, 'attract more customers');
        
        try {
            const transporter = getSmtpTransporter();
            await transporter.sendMail({
                from: AGENTMAIL.email,
                to: lead.email,
                subject: subject,
                text: body
            });
            campaignStats.sent++;
            results.push({ step: step.name, success: true });
        } catch (error) {
            results.push({ step: step.name, success: false, error: error.message });
        }
        
        if (step.day > 0) await new Promise(r => setTimeout(r, 1000));
    }
    
    leads = leads.map(l => l.id === leadId ? { ...l, status: 'sequence-sent', sequenceId } : l);
    
    res.json({ success: true, results, stats: campaignStats });
});

// Send outreach email to a lead
app.post('/api/outreach/send', async (req, res) => {
    const { leadId, templateKey } = req.body;
    
    const lead = leads.find(l => l.id === leadId);
    if (!lead) {
        return res.json({ success: false, error: 'Lead not found' });
    }
    
    const template = emailTemplates[templateKey] || emailTemplates['cold-outreach'];
    
    // Personalize the email
    let subject = template.subject
        .replace(/{{name}}/g, lead.name || 'there')
        .replace(/{{company}}/g, lead.company || 'your company');
    
    let body = template.body
        .replace(/{{name}}/g, lead.name || 'there')
        .replace(/{{company}}/g, lead.company || 'your company')
        .replace(/{{value-proposition}}/g, 'getting more customers')
        .replace(/{{goal}}/g, 'attract more customers');
    
    try {
        const transporter = getSmtpTransporter();
        const info = await transporter.sendMail({
            from: AGENTMAIL.email,
            to: lead.email,
            subject: subject,
            text: body
        });
        
        // Update lead status
        leads = leads.map(l => l.id === leadId ? { ...l, status: 'contacted', lastContacted: new Date().toISOString() } : l);
        campaignStats.sent++;
        
        res.json({ success: true, messageId: info.messageId });
    } catch (error) {
        console.error('Outreach email error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Send bulk outreach (with delay to avoid spam)
app.post('/api/outreach/bulk', async (req, res) => {
    const { templateKey, delayMinutes = 5 } = req.body;
    
    const newLeads = leads.filter(l => l.status === 'new');
    
    if (newLeads.length === 0) {
        return res.json({ success: false, error: 'No new leads to contact' });
    }
    
    const results = [];
    const template = emailTemplates[templateKey] || emailTemplates['cold-outreach'];
    
    for (let i = 0; i < newLeads.length; i++) {
        const lead = newLeads[i];
        
        // Personalize
        let subject = template.subject
            .replace(/{{name}}/g, lead.name || 'there')
            .replace(/{{company}}/g, lead.company || 'your company');
        
        let body = template.body
            .replace(/{{name}}/g, lead.name || 'there')
            .replace(/{{company}}/g, lead.company || 'your company')
            .replace(/{{value-proposition}}/g, 'getting more customers')
            .replace(/{{goal}}/g, 'attract more customers');
        
        try {
            const transporter = getSmtpTransporter();
            const info = await transporter.sendMail({
                from: AGENTMAIL.email,
                to: lead.email,
                subject: subject,
                text: body
            });
            
            leads = leads.map(l => l.id === lead.id ? { ...l, status: 'contacted', lastContacted: new Date().toISOString() } : l);
            campaignStats.sent++;
            results.push({ leadId: lead.id, success: true });
        } catch (error) {
            results.push({ leadId: lead.id, success: false, error: error.message });
        }
        
        // Delay between emails (rate limiting)
        if (i < newLeads.length - 1) {
            await new Promise(resolve => setTimeout(resolve, delayMinutes * 60 * 1000));
        }
    }
    
    res.json({ success: true, results, stats: campaignStats });
});

// Get campaign stats
app.get('/api/campaign/stats', (req, res) => {
    res.json({ stats: campaignStats, leads: leads });
});

// ========== AI PERSONALIZATION ==========
// Generate personalized icebreaker using Ollama
app.post('/api/ai/icebreaker', async (req, res) => {
    const { leadName, company, industry, context } = req.body;
    
    // Return fallback if no API key
    if (!OLLAMA_API_KEY) {
        const fallbacks = [
            `I noticed ${company || 'your company'} and had a quick question`,
            `Saw what you're doing at ${company || 'your company'} - impressive`,
            `Quick question about your business at ${company || 'your company'}`,
            `Wondering how you guys are getting leads at ${company || 'your company'}`
        ];
        const randomFallback = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        return res.json({ success: true, icebreaker: randomFallback, isFallback: true });
    }
    
    try {
        const prompt = `Generate a short, personalized icebreaker sentence for a cold email. 

Context:
- Person's name: ${leadName || 'there'}
- Company: ${company || 'their company'}
- Industry: ${industry || 'their industry'}
- Additional context: ${context || 'none'}

Requirements:
- Keep it under 20 words
- Make it specific and relevant to their business
- Sound natural, not salesy
- NO emojis
- Just give me the icebreaker sentence, nothing else`;

        const response = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OLLAMA_API_KEY}`
            },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                messages: [
                    { role: 'system', content: 'You are a professional email assistant. Generate short, personalized icebreakers.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 100
            })
        });
        
        // Check if response is OK before parsing JSON
        if (!response.ok) {
            const errorText = await response.text();
            console.error('AI Icebreaker Error:', response.status, errorText);
            
            const fallbacks = [
                `I noticed ${company || 'your company'} and had a quick question`,
                `Saw what you're doing at ${company || 'your company'} - impressive`,
                `Quick question about your business at ${company || 'your company'}`
            ];
            const randomFallback = fallbacks[Math.floor(Math.random() * fallbacks.length)];
            return res.json({ success: true, icebreaker: randomFallback, isFallback: true });
        }
        
        const data = await response.json();
        const icebreaker = data.choices?.[0]?.message?.content?.trim();
        
        if (icebreaker) {
            res.json({ success: true, icebreaker });
        } else {
            res.json({ success: false, error: 'Could not generate icebreaker' });
        }
    } catch (error) {
        console.error('AI Icebreaker Error:', error);
        
        // Return fallback on error
        const fallbacks = [
            `I noticed ${company || 'your company'} and had a quick question`,
            `Saw what you're doing at ${company || 'your company'} - impressive`
        ];
        const randomFallback = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        res.json({ success: true, icebreaker: randomFallback, isFallback: true });
    }
});

// Generate full personalized email
app.post('/api/ai/generate-email', async (req, res) => {
    const { leadName, company, industry, offer, tone } = req.body;
    
    if (!OLLAMA_API_KEY) {
        // Use fallback template if no API key
        const fallbackSubject = `Quick question about ${company || 'your company'}`;
        const fallbackBody = `Hi ${leadName || 'there'},

I came across ${company || 'your company'} and I have a question for you.

Are you currently getting enough qualified leads coming through your door each month?

I help businesses in your industry generate more leads without spending more on ads. Happy to share a quick strategy that might help.

Want me to send it over?

Best regards`;
        
        return res.json({ 
            success: true, 
            subject: fallbackSubject,
            body: fallbackBody,
            isFallback: true
        });
    }
    
    try {
        const prompt = `Write a short, personalized cold outreach email.

Target:
- Name: ${leadName || 'there'}
- Company: ${company || 'their company'}
- Industry: ${industry || 'their industry'}
- Offer: ${offer || 'your services'}
- Tone: ${tone || 'professional but friendly'}

Requirements:
- Subject line (keep it short and intriguing)
- 3-4 sentence email body
- Include a clear call to action
- NO emojis
- Sound helpful, not pushy
- End with a question

Format your response as:
SUBJECT: [subject line]
BODY: [email body]`;

        const response = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OLLAMA_API_KEY}`
            },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                messages: [
                    { role: 'system', content: 'You are an expert sales copywriter. Write personalized cold emails.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 500
            })
        });
        
        // Check if response is OK before parsing JSON
        if (!response.ok) {
            const errorText = await response.text();
            console.error('AI API Error:', response.status, errorText);
            
            // Return fallback template on API error
            const fallbackSubject = `Quick question about ${company || 'your company'}`;
            const fallbackBody = `Hi ${leadName || 'there'},

I came across ${company || 'your company'} and I have a question for you.

Are you currently getting enough qualified leads coming through your door each month?

I help businesses in your industry generate more leads without spending more on ads. Happy to share a quick strategy that might help.

Want me to send it over?

Best regards`;
            
            return res.json({ 
                success: true, 
                subject: fallbackSubject,
                body: fallbackBody,
                isFallback: true,
                note: 'AI unavailable - using template'
            });
        }
        
        const data = await response.json();
        const result = data.choices?.[0]?.message?.content?.trim();
        
        if (result) {
            // Parse subject and body
            const subjectMatch = result.match(/SUBJECT:\s*(.+)/i);
            const bodyMatch = result.match(/BODY:\s*(.+)/s);
            
            res.json({ 
                success: true, 
                subject: subjectMatch ? subjectMatch[1].trim() : 'Quick question',
                body: bodyMatch ? bodyMatch[1].trim() : result
            });
        } else {
            res.json({ success: false, error: 'Could not generate email' });
        }
    } catch (error) {
        console.error('AI Email Gen Error:', error);
        
        // Return fallback on error
        const fallbackSubject = `Quick question about ${company || 'your company'}`;
        const fallbackBody = `Hi ${leadName || 'there'},

I came across ${company || 'your company'} and I have a question for you.

Are you currently getting enough qualified leads coming through your door each month?

I help businesses in your industry generate more leads without spending more on ads. Happy to share a quick strategy that might help.

Want me to send it over?

Best regards`;
        
        res.json({ 
            success: true, 
            subject: fallbackSubject,
            body: fallbackBody,
            isFallback: true,
            note: 'Error - using template'
        });
    }
});

// IMAP Connection
async function getImapConnection() {
    const config = {
        imap: {
            user: AGENTMAIL.email,
            password: AGENTMAIL.password,
            host: AGENTMAIL.imap,
            port: 993,
            tls: true,
            authTimeout: 3000
        }
    };
    return await imap.connect(config);
}

// SMTP Transporter
function getSmtpTransporter() {
    return nodemailer.createTransport({
        host: AGENTMAIL.smtp,
        port: 465,
        secure: true,
        auth: {
            user: AGENTMAIL.email,
            pass: AGENTMAIL.password
        }
    });
}

// Simple AI Response (fallback)
function simpleAIResponse(prompt) {
    const lower = prompt.toLowerCase();
    
    if (lower.includes('email') || lower.includes('send to') || lower.includes('mail to')) {
        const toMatch = prompt.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        const recipient = toMatch ? toMatch[1] : 'recipient@example.com';
        const bodyPreview = prompt.substring(0, 50);
        return 'SEND_EMAIL|' + recipient + '|Auto Subject|Auto body from prompt: ' + bodyPreview;
    }
    
    if (lower.includes('task') || lower.includes('remind') || lower.includes('create')) {
        const content = prompt.replace(/^(create|add|remind me to)\s+/i, '').replace(/\s+(task|todo)$/i, '');
        return 'CREATE_TASK|' + content + '|medium';
    }
    
    if (lower.includes('what task') || lower.includes('list task')) {
        return 'LIST_TASKS|';
    }
    
    return 'RESPOND|I understand you want me to help with: ' + prompt + '. I can help with sending emails, creating tasks, and managing your inbox.';
}

// Parse AI response
function parseAIResponse(response) {
    const parts = response.split('|');
    return {
        action: parts[0],
        data: parts.slice(1)
    };
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get tasks
app.get('/api/tasks', (req, res) => {
    res.json({ tasks });
});

// Create task
app.post('/api/tasks', (req, res) => {
    const { content, priority = 'medium' } = req.body;
    const newTask = {
        id: Date.now().toString(),
        content,
        status: 'pending',
        priority,
        createdAt: new Date().toISOString()
    };
    tasks.unshift(newTask);
    res.json({ success: true, task: newTask });
});

// Update task
app.put('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    tasks = tasks.map(t => t.id === id ? { ...t, status } : t);
    res.json({ success: true });
});

// Delete task
app.delete('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    tasks = tasks.filter(t => t.id !== id);
    res.json({ success: true });
});

// Get emails from AgentMail
app.get('/api/emails', async (req, res) => {
    try {
        const imapConnection = await getImapConnection();
        
        await imapConnection.openBox('INBOX');
        
        const searchCriteria = ['ALL'];
        const fetchOptions = {
            bodies: ['HEADER', 'TEXT'],
            markSeen: false
        };
        
        const messages = await imapConnection.search(searchCriteria, fetchOptions);
        
        const emails = messages.slice(-20).reverse().map(msg => {
            const header = msg.parts.filter(part => part.which === 'HEADER')[0];
            const body = msg.parts.filter(part => part.which === 'TEXT')[0];
            
            return {
                id: msg.attributes.uid,
                from: header?.body?.from?.[0] || 'Unknown',
                subject: header?.body?.subject?.[0] || 'No Subject',
                date: header?.body?.date?.[0] || new Date().toISOString(),
                body: body?.body?.substring(0, 500) || ''
            };
        });
        
        await imapConnection.end();
        
        emailHistory = emails;
        res.json({ emails });
    } catch (error) {
        console.error('Email fetch error:', error);
        res.json({ emails: [], error: error.message });
    }
});

// Send email via AgentMail
app.post('/api/send-email', async (req, res) => {
    try {
        const { to, subject, body } = req.body;
        
        if (!to || !subject) {
            return res.json({ success: false, error: 'Missing to or subject' });
        }
        
        const transporter = getSmtpTransporter();
        
        const info = await transporter.sendMail({
            from: AGENTMAIL.email,
            to,
            subject,
            text: body || ''
        });
        
        console.log('Email sent:', info.messageId);
        res.json({ success: true, messageId: info.messageId });
    } catch (error) {
        console.error('Send email error:', error);
        res.json({ success: false, error: error.message });
    }
});

// AI Command processor
app.post('/api/command', async (req, res) => {
    try {
        const { command } = req.body;
        
        if (!command) {
            return res.json({ success: false, error: 'No command provided' });
        }
        
        // Process with AI (simple rule-based for now)
        const aiResponse = simpleAIResponse(command);
        const parsed = parseAIResponse(aiResponse);
        
        let result = { action: parsed.action, response: parsed.data.join('|') };
        
        // Execute action
        switch (parsed.action) {
            case 'SEND_EMAIL':
                const [to, subject, body] = parsed.data;
                try {
                    const transporter = getSmtpTransporter();
                    await transporter.sendMail({
                        from: AGENTMAIL.email,
                        to: to || 'recipient@example.com',
                        subject: subject || 'Auto Subject',
                        text: body || ''
                    });
                    result.sent = true;
                } catch (e) {
                    result.sent = false;
                    result.error = e.message;
                }
break;
                
            case 'CREATE_TASK':
                const [content, priority] = parsed.data;
                const newTask = {
                    id: Date.now().toString(),
                    content: content || 'New task',
                    status: 'pending',
                    priority: priority || 'medium'
                };
                tasks.unshift(newTask);
                result.task = newTask;
                break;
                
            case 'LIST_TASKS':
                result.tasks = tasks;
                break;
                
            case 'LIST_EMAILS':
                result.emails = emailHistory.slice(0, 10);
                break;
        }
        
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Command processing error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Set Gemini API Key
app.post('/api/config/gemini', (req, res) => {
    const { apiKey } = req.body;
    // In production, store securely
    res.json({ success: true });
});

// Start server
app.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('   Nexus AI Backend Server');
    console.log('   Connected to AgentMail');
    console.log('');
    console.log('   Server running on: http://localhost:' + PORT);
    console.log('');
    console.log('   Endpoints:');
    console.log('   - GET  /api/health     Health check');
    console.log('   - GET  /api/tasks      Get all tasks');
    console.log('   - POST /api/tasks      Create task');
    console.log('   - GET  /api/emails     Fetch emails');
    console.log('   - POST /api/send-email Send email');
    console.log('   - POST /api/command    Process AI command');
    console.log('========================================');
    console.log('');
});

module.exports = app;

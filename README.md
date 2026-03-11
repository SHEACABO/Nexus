# Nexus AI - Full Stack with AgentMail

A complete AI email assistant powered by Node.js backend and AgentMail.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd server
npm install
```

### 2. Start the Backend Server
```bash
npm start
```

The server will start on **http://localhost:3000**

### 3. Open the Dashboard
Open `server/public/index.html` in your browser, or serve it:
```bash
npx serve public
```

---

## 📧 AgentMail Configuration

The backend is pre-configured with your AgentMail credentials:

| Setting | Value |
|---------|-------|
| Email | `shyliterature328@agentmail.to` |
| Password | (API key from config) |
| SMTP | `smtp.agentmail.to:465` |
| IMAP | `imap.agentmail.to:993` |

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/tasks` | Get all tasks |
| POST | `/api/tasks` | Create task |
| PUT | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks/:id` | Delete task |
| GET | `/api/emails` | Fetch emails from inbox |
| POST | `/api/send-email` | Send email |
| POST | `/api/command` | Process AI command |

---

## 🤖 AI Commands

Try these commands in the AI Assistant:

- **Email**: "Email john@company.com about the project update"
- **Task**: "Create a task to review the proposal"
- **List**: "What tasks do I have?"
- **Emails**: "Show my recent emails"

---

## 🛠️ Adding Google Gemini AI

1. Get a free API key from https://aistudio.google.com/app/apikey
2. Edit `server.js` and add your key:
```javascript
const GEMINI_API_KEY = 'your-api-key-here';
```
3. Restart the server

---

## 📁 Project Structure

```
nexus-ai/
├── server/
│   ├── server.js          # Main backend server
│   ├── package.json        # Dependencies
│   └── public/
│       └── index.html     # Frontend dashboard
├── dist/
│   ├── index.html         # Landing page
│   └── dashboard.html     # Standalone demo
└── README.md
```

---

## 🌐 Production Deployment

For real production use:

1. **Deploy Frontend**: Upload the `public/index.html` to any static host
2. **Deploy Backend**: Deploy Node.js server to Render, Railway, or VPS
3. **Environment Variables**: Set secure environment variables for passwords
4. **Database**: Replace in-memory storage with PostgreSQL or MongoDB

---

## 💰 Monetization Opportunities

With this AgentMail-powered AI:

1. **Email Automation Service** - Businesses pay to automate email workflows
2. **Customer Support AI** - AI handles support emails automatically  
3. **Virtual Assistants** - Sell AI assistants to professionals
4. **Lead Generation** - AI finds and contacts potential customers

---

## ⚠️ Notes

- The backend uses in-memory storage (tasks reset on restart)
- For production, add a real database (PostgreSQL, MongoDB)
- Add rate limiting to prevent abuse
- Implement proper authentication

---

**Built with Node.js + AgentMail API**

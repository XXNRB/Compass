# Compass 🧭

### AI-Powered College Companion

Compass is a smart scheduling and productivity app built for college students. It uses Claude AI to automatically scan your emails, extract important dates and events, and organize everything into a unified calendar — so you never miss a deadline, career fair, internship opportunity, or class event again.

---

## What It Does

- **AI Email Scanning** — Connects to Gmail and Outlook, reads your emails, and automatically detects scheduling information like internship deadlines, professor meetings, career fairs, club events, and housing deadlines
- **Smart Priority System** — Claude rates every detected event 1–5 stars based on how important it is to your academic and career success
- **Unified Calendar** — All detected events appear on a monthly calendar with a day-detail panel showing hourly time slots
- **Google Calendar Sync** — High-priority events (exams, interviews, deadlines) can be added to your Google Calendar
- **Syllabus Scanner** — Upload a PDF syllabus and Claude extracts every exam, quiz, assignment, and deadline
- **Thread Deduplication** — Multiple emails about the same topic are grouped into one event card, not shown separately

---

## Tech Stack


| Layer        | Technology                                         |
| ------------ | -------------------------------------------------- |
| Backend      | Node.js + Express                                  |
| Frontend     | React + Vite                                       |
| Database     | Supabase (PostgreSQL)                              |
| AI           | Anthropic Claude API (`claude-haiku-4-5-20251001`) |
| Auth         | Google OAuth 2.0, Microsoft OAuth 2.0              |
| Email APIs   | Gmail API, Microsoft Graph API                     |
| Calendar     | Google Calendar API                                |
| PDF Parsing  | pdf-parse                                          |
| File Uploads | multer                                             |


---

## Project Structure

```
schedulo/
├── backend/                    # Express API server
│   ├── src/
│   │   ├── index.js            # Server entry point — loads env, middleware, routes
│   │   ├── config/
│   │   │   └── supabase.js     # Supabase client configuration
│   │   ├── routes/
│   │   │   ├── google.js       # Google OAuth login + callback
│   │   │   ├── microsoft.js    # Microsoft OAuth login + callback
│   │   │   ├── emails.js       # Gmail + Outlook email scanning endpoints
│   │   │   └── events.js       # Fetch user events from database
│   │   └── services/
│   │       ├── emailScanner.js     # Gmail fetching + Claude email analysis
│   │       ├── outlookScanner.js   # Outlook fetching via Microsoft Graph API
│   │       └── syllabusScanner.js  # PDF text → Claude → calendar events
│   ├── .env                    # Secret keys (never committed to git)
│   └── package.json
│
└── web/                        # React frontend
    ├── src/
    │   ├── main.jsx            # App entry point
    │   ├── App.jsx             # Route definitions
    │   ├── styles.css          # Global dark theme styles
    │   └── pages/
    │       ├── Landing.jsx     # Home page with Gmail/Outlook connect buttons
    │       ├── Dashboard.jsx   # Email scan results with priority cards
    │       └── Calendar.jsx    # Monthly calendar + day detail panel
    ├── index.html
    ├── vite.config.js
    └── package.json
```

---

## How The AI Works

### Email Scanning

1. User connects Gmail or Outlook via OAuth
2. Compass fetches the 20 most recent emails
3. Each email (subject, sender, date, snippet) is sent to Claude
4. Claude analyzes it and returns structured JSON:
  - `hasSchedulingInfo` — is there anything schedulable here?
  - `eventTitle` — what is this event called?
  - `eventDate` — when is it?
  - `eventTime` — what time?
  - `priority` — 1 to 5 stars
  - `schedulingType` — internship, exam, deadline, housing, etc.
5. Detected events are saved to Supabase and shown on the dashboard
6. Emails from the same thread are deduplicated — one card per conversation

### Priority System


| Stars | Meaning  | Examples                                                                   |
| ----- | -------- | -------------------------------------------------------------------------- |
| ⭐⭐⭐⭐⭐ | Critical | Active recruiter contact, internship offer, professor meeting about grades |
| ⭐⭐⭐⭐  | High     | New internship opportunity, exam deadline, career fair                     |
| ⭐⭐⭐   | Medium   | Office hours, club meeting, group project coordination                     |
| ⭐⭐    | Low      | Optional campus events, newsletters with dates                             |
| ⭐     | Minimal  | Marketing emails, automated notifications                                  |


### Syllabus Scanning

1. User uploads a PDF syllabus
2. `pdf-parse` extracts the raw text
3. Text is sent to Claude with instructions to find every date and event
4. Claude returns a structured array of events with dates, times, and types
5. Events are saved to Supabase
6. Exams, quizzes, and deadlines can be added to Google Calendar

---

## API Endpoints


| Method | Endpoint                       | Description                         |
| ------ | ------------------------------ | ----------------------------------- |
| `GET`  | `/api/health`                  | Health check                        |
| `GET`  | `/api/auth/google`             | Start Google OAuth flow             |
| `GET`  | `/api/auth/google/callback`    | Google OAuth callback               |
| `GET`  | `/api/auth/microsoft`          | Start Microsoft OAuth flow          |
| `GET`  | `/api/auth/microsoft/callback` | Microsoft OAuth callback            |
| `GET`  | `/api/emails/scan`             | Scan Gmail inbox with Claude        |
| `GET`  | `/api/emails/scan/outlook`     | Scan Outlook inbox with Claude      |
| `GET`  | `/api/events`                  | Fetch events for the logged-in user |


---

## Database Schema (Supabase)

### `users` table


| Column           | Type        | Description                   |
| ---------------- | ----------- | ----------------------------- |
| id               | uuid        | Primary key                   |
| email            | text        | User's email address          |
| name             | text        | Display name                  |
| google_tokens    | jsonb       | Stored Google OAuth tokens    |
| microsoft_tokens | jsonb       | Stored Microsoft OAuth tokens |
| created_at       | timestamptz | Account creation time         |


### `events` table


| Column          | Type        | Description                               |
| --------------- | ----------- | ----------------------------------------- |
| id              | uuid        | Primary key                               |
| user_id         | uuid        | Foreign key to users                      |
| title           | text        | Event name                                |
| description     | text        | Claude's reasoning                        |
| raw_date        | text        | Date as Claude extracted it               |
| event_time      | text        | Time as Claude extracted it               |
| start_time      | timestamptz | Parsed start time (null if vague)         |
| location        | text        | Location if detected                      |
| source          | text        | `gmail`, `outlook`, or `syllabus`         |
| scheduling_type | text        | internship, exam, deadline, etc.          |
| priority        | int         | 1–5 star rating                           |
| status          | text        | pending, approved, rejected               |
| thread_id       | text        | Gmail/Outlook thread ID for deduplication |
| email_count     | int         | Number of emails in this thread           |


---

## Getting Started (Local Development)

### Prerequisites

- Node.js v18+
- A Supabase account and project
- Google Cloud Console project with Gmail + Calendar APIs enabled
- Microsoft Azure app registration
- Anthropic API key

### Setup

**1. Clone the repo**

```bash
git clone https://github.com/d-kofidy/Compass.git
cd Compass
```

**2. Install backend dependencies**

```bash
cd backend
npm install
```

**3. Create your `.env` file**

Create `backend/.env` and fill in your credentials (see Environment Variables below).

**4. Install frontend dependencies**

```bash
cd ../web
npm install
```

**5. Run the app**

```bash
# Terminal 1 — Backend
cd backend
npm run dev

# Terminal 2 — Frontend
cd web
npm run dev
```

**6. Open in browser**

```
http://localhost:5173
```

---

## Environment Variables

Create `backend/.env` with these keys:

```env
PORT=3000
NODE_ENV=development
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
MICROSOFT_CLIENT_ID=your_microsoft_client_id
MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=http://localhost:3000/api/auth/microsoft/callback
ANTHROPIC_API_KEY=your_anthropic_api_key
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_key
SESSION_SECRET=a_long_random_string
FRONTEND_URL=http://localhost:5173
```

---

## Roadmap

### Phase 1 — Smart Scheduling (in progress)

- Gmail OAuth + email scanning
- Microsoft OAuth + Outlook scanning
- Claude AI event extraction
- Supabase database
- Dashboard with priority cards
- Calendar with day detail view
- Syllabus PDF parsing service
- Syllabus upload API route + UI
- Swipe to approve/reject events
- Write approved events to Google Calendar

### Phase 2 — Academic Roadmap

- Degree planner and 4-year course mapping
- Canvas LMS integration
- GPA impact simulator
- Course registration deadline alerts

### Phase 3 — Note Taking

- Voice to text lecture recording
- AI note generation
- Flashcard generator
- Exam study reminders

### Phase 4 — Housing Intelligence

- Dorm and off-campus comparisons
- Lease review assistant
- Housing deadline tracker

### Phase 5 — Career Navigator

- Internship roadmap by year
- AI resume builder
- Interview prep generator
- LinkedIn integration

### Phase 6 — Mobile App

- iOS and Android via Expo React Native
- Push notifications
- Social scheduling

### Phase 7 — Polish & Launch

- Full UI redesign
- Supabase Row Level Security
- Google OAuth verification
- App Store launch

---

## Built By

**Kofi Dadzie-Yeboah**  
Computer Science + Economics, Washington University in St. Louis  
[GitHub](https://github.com/d-kofidy)

---

*Compass is currently in active development.*
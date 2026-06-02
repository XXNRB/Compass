import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';


const API_BASE = 'http://localhost:3000/api';


const PRIORITY_COLORS = {
 5: '#ef4444',
 4: '#f97316',
 3: '#eab308',
 2: '#3b82f6',
 1: '#9ca3af',
};


/** Keep first event per Gmail threadId; events without threadId are all kept. */
function deduplicateByThreadId(events) {
 const seenThreadIds = new Set();


 return events.filter((item) => {
   const threadId = item.email?.threadId;
   if (!threadId) return true;
   if (seenThreadIds.has(threadId)) return false;
   seenThreadIds.add(threadId);
   return true;
 });
}


function PriorityStars({ priority }) {
 const level = Math.min(5, Math.max(1, Number(priority) || 1));
 const color = PRIORITY_COLORS[level] || PRIORITY_COLORS[1];


 return (
   <span className="priority-stars" title={`Priority ${level}/5`}>
     {[1, 2, 3, 4, 5].map((star) => (
       <span
         key={star}
         style={{ color: star <= level ? color : '#334155' }}
       >
         ★
       </span>
     ))}
   </span>
 );
}


function Dashboard() {
 const [userEmail, setUserEmail] = useState('');
 const [events, setEvents] = useState([]);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState(null);
 const [scanMeta, setScanMeta] = useState(null);


 // Restore email from URL param (after OAuth) or localStorage
 useEffect(() => {
   const params = new URLSearchParams(window.location.search);
   const emailFromUrl = params.get('email');
   if (emailFromUrl) {
     localStorage.setItem('compassUserEmail', emailFromUrl);
     setUserEmail(emailFromUrl);
     window.history.replaceState({}, '', '/dashboard');
   } else {
     setUserEmail(localStorage.getItem('compassUserEmail') || 'Not signed in');
   }
   const userIdFromUrl = params.get('userId');
 if (userIdFromUrl) {
 localStorage.setItem('compassUserId', userIdFromUrl);
}
 }, []);


 async function handleScan() {
   setLoading(true);
   setError(null);
   setScanMeta(null);


   try {
     const { data } = await axios.get(`${API_BASE}/emails/scan`, {
       withCredentials: true,
     });


     const dedupedEvents = deduplicateByThreadId(data.events || []);
     setEvents(dedupedEvents);
     setScanMeta({ total: data.total, saved: data.saved });
   } catch (err) {
     const message =
       err.response?.data?.error ||
       err.response?.data?.message ||
       'Failed to scan emails. Connect Gmail first.';
     setError(message);
     setEvents([]);
   } finally {
     setLoading(false);
   }
 }


 return (
   <div className="page">
     {/* --- Header --- */}
     <header
       style={{
         padding: '1.25rem 0',
         borderBottom: '1px solid var(--border)',
         background: 'rgba(13, 19, 36, 0.8)',
         backdropFilter: 'blur(12px)',
         position: 'sticky',
         top: 0,
         zIndex: 10,
       }}
     >
       <div
         className="container"
         style={{
           display: 'flex',
           alignItems: 'center',
           justifyContent: 'space-between',
           flexWrap: 'wrap',
           gap: '1rem',
         }}
       >
         <Link
           to="/"
           style={{
             fontSize: '1.35rem',
             fontWeight: 700,
             background: 'var(--gradient-hero)',
             WebkitBackgroundClip: 'text',
             WebkitTextFillColor: 'transparent',
         }}
>
 Compass
</Link>
<div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
 <Link to="/calendar" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
   Calendar
 </Link>
 <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
   {userEmail}
 </span>
</div>
       </div>
     </header>


     <main className="container" style={{ padding: '2.5rem 1.5rem 4rem' }}>
       <div
         style={{
           display: 'flex',
           flexWrap: 'wrap',
           alignItems: 'center',
           justifyContent: 'space-between',
           gap: '1rem',
           marginBottom: '2rem',
         }}
       >
         <div>
           <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.35rem' }}>
             Detected events
           </h1>
           <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
             Scan your Gmail for scheduling-related messages
           </p>
         </div>
         <button
           type="button"
           className="btn btn-primary"
           onClick={handleScan}
           disabled={loading}
         >
           {loading ? 'Scanning…' : 'Scan My Emails'}
         </button>
       </div>


       {error && <div className="error-banner">{error}</div>}


       {scanMeta && !loading && (
         <p
           style={{
             color: 'var(--text-muted)',
             fontSize: '0.9rem',
             marginBottom: '1.5rem',
           }}
         >
           Found {scanMeta.total} event{scanMeta.total !== 1 ? 's' : ''}
           {typeof scanMeta.saved === 'number' && ` · ${scanMeta.saved} saved to database`}
         </p>
       )}


       {loading && (
         <div className="loading-block">
           <div className="spinner" />
           <p>Scanning your inbox with AI…</p>
         </div>
       )}


       {!loading && events.length === 0 && !error && (
         <div className="empty-state">
           <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
             No events yet
           </p>
           <p>Click &quot;Scan My Emails&quot; to find scheduling info in your inbox.</p>
         </div>
       )}


       {!loading &&
         events.map((item, index) => {
           const { email, analysis } = item;
           const title =
             analysis?.eventTitle || email?.subject || 'Untitled event';
           const schedulingType =
             analysis?.schedulingType || 'other';
           const priority = analysis?.priority ?? 3;


           return (
             <article key={email?.id || index} className="event-card">
               <div className="event-card-header">
                 <h2 className="event-title">{title}</h2>
                 <div className="event-meta">
                   <PriorityStars priority={priority} />
                   <span className="badge">{schedulingType}</span>
                 </div>
               </div>


               {analysis?.location && (
                 <p className="event-detail">📍 {analysis.location}</p>
               )}
               {analysis?.eventDate && (
                 <p className="event-detail">🗓 {analysis.eventDate}</p>
               )}
               {analysis?.eventTime && (
                 <p className="event-detail">🕐 {analysis.eventTime}</p>
               )}
               {email?.from && (
                 <p className="event-detail">From: {email.from}</p>
               )}


               {analysis?.reasoning && (
                 <p className="event-reasoning">{analysis.reasoning}</p>
               )}
             </article>
           );
         })}
     </main>
   </div>
 );
}


export default Dashboard;

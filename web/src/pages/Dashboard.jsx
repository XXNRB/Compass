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
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState(null);
 const [scanMeta, setScanMeta] = useState(null);
 const [syllabusFile, setSyllabusFile] = useState(null);
 const [courseName, setCourseName] = useState('');
 const [courseCode, setCourseCode] = useState('');
 const [syllabusLoading, setSyllabusLoading] = useState(false);
 const [syllabusMessage, setSyllabusMessage] = useState(null);
 const [syllabusError, setSyllabusError] = useState(null);
 const [syncLoading, setSyncLoading] = useState(false);
 const [syncMessage, setSyncMessage] = useState(null);
 const [outlookLoading, setOutlookLoading] = useState(false);
 const [pendingEvents, setPendingEvents] = useState([]);
 const [pendingLoading, setPendingLoading] = useState(true);
 const [actionPendingId, setActionPendingId] = useState(null);

 async function fetchPendingEvents() {
   try {
     const userId = localStorage.getItem('compassUserId') || '';
     const { data } = await axios.get(`${API_BASE}/events?userId=${userId}`, {
       withCredentials: true,
     });
     setPendingEvents((data.events || []).filter((event) => event.status === 'pending'));
   } catch (err) {
     // Non-fatal: leave whatever list is already on screen.
   } finally {
     setPendingLoading(false);
   }
 }

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
 if (userIdFromUrl && userIdFromUrl !== 'undefined') {
 localStorage.setItem('compassUserId', userIdFromUrl);
}
   fetchPendingEvents();
 }, []);

 async function handleApprove(id) {
   setActionPendingId(id);
   try {
     const userId = localStorage.getItem('compassUserId') || '';
     await axios.patch(
       `${API_BASE}/events/${id}?userId=${userId}`,
       { status: 'approved' },
       { withCredentials: true },
     );
     setPendingEvents((prev) => prev.filter((event) => event.id !== id));
   } catch (err) {
     const message =
       err.response?.data?.error ||
       err.response?.data?.message ||
       'Failed to approve event.';
     setError(message);
   } finally {
     setActionPendingId(null);
   }
 }

 async function handleReject(id) {
   setActionPendingId(id);
   try {
     const userId = localStorage.getItem('compassUserId') || '';
     await axios.patch(
       `${API_BASE}/events/${id}?userId=${userId}`,
       { status: 'rejected' },
       { withCredentials: true },
     );
     setPendingEvents((prev) => prev.filter((event) => event.id !== id));
   } catch (err) {
     const message =
       err.response?.data?.error ||
       err.response?.data?.message ||
       'Failed to reject event.';
     setError(message);
   } finally {
     setActionPendingId(null);
   }
 }


 async function handleScan() {
   setLoading(true);
   setError(null);
   setScanMeta(null);


   try {
     const { data } = await axios.get(`${API_BASE}/emails/scan`, {
       withCredentials: true,
     });


     setScanMeta({ total: data.total, saved: data.saved });
     await fetchPendingEvents();
   } catch (err) {
     const message =
       err.response?.data?.error ||
       err.response?.data?.message ||
       'Failed to scan emails. Connect Gmail first.';
     setError(message);
   } finally {
     setLoading(false);
   }
 }
 async function handleGoogleCalendarSync() {
  setSyncLoading(true);
  setSyncMessage(null);
  try {
    const userId = localStorage.getItem('compassUserId') || '';
    const { data } = await axios.get(
      `${API_BASE}/calendar/sync/google?userId=${userId}`,
      { withCredentials: true },
    );
    setSyncMessage(`Imported ${data.imported} of ${data.total} Google Calendar events`);
  } catch (err) {
    const message =
      err.response?.data?.error ||
      err.response?.data?.message ||
      'Failed to sync Google Calendar. Connect Google first.';
    setSyncMessage(message);
  } finally {
    setSyncLoading(false);
  }
}

 async function handleScanOutlook() {
   setOutlookLoading(true);
   setError(null);

   try {
     const userId = localStorage.getItem('compassUserId') || '';
     const { data } = await axios.get(`${API_BASE}/emails/scan/outlook?userId=${userId}`, {
       withCredentials: true,
     });

     setScanMeta((prev) => ({
       total: (prev?.total || 0) + (data.total || 0),
       saved: (prev?.saved || 0) + (data.saved || 0),
     }));
     await fetchPendingEvents();
   } catch (err) {
     const message =
       err.response?.data?.error ||
       err.response?.data?.message ||
       'Failed to scan Outlook emails. Connect Outlook first.';
     setError(message);
   } finally {
     setOutlookLoading(false);
   }
 }

 async function handleSyllabusUpload(event) {
   event.preventDefault();

   if (!syllabusFile) {
     setSyllabusError('Please select a PDF syllabus to upload.');
     return;
   }

   setSyllabusLoading(true);
   setSyllabusError(null);
   setSyllabusMessage(null);

   try {
     const formData = new FormData();
     formData.append('syllabus', syllabusFile);
     formData.append('courseName', courseName);
     formData.append('courseCode', courseCode);
     formData.append('userId', localStorage.getItem('compassUserId') || '');

     const { data } = await axios.post(`${API_BASE}/syllabus/upload`, formData, {
       withCredentials: true,
     });

     if (data.duplicate) {
       setSyllabusMessage(data.message || 'This syllabus has already been uploaded. No new events were added.');
       return;
     }

     const total = data.total ?? 0;
     const googleCalendarAdded = data.googleCalendarAdded ?? 0;
     setSyllabusMessage(
       `Found ${total} event${total !== 1 ? 's' : ''} — ${googleCalendarAdded} added to Google Calendar`,
     );

     await fetchPendingEvents();
   } catch (err) {
     const message =
       err.response?.data?.error ||
       err.response?.data?.message ||
       'Failed to upload syllabus.';
     setSyllabusError(message);
   } finally {
     setSyllabusLoading(false);
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
         <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleScan}
            disabled={loading}
          >
            {loading ? 'Scanning…' : 'Scan My Emails'}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleScanOutlook}
            disabled={outlookLoading}
          >
            {outlookLoading ? 'Scanning…' : 'Scan Outlook Emails'}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleGoogleCalendarSync}
            disabled={syncLoading}
          >
            {syncLoading ? 'Syncing…' : '📅 Sync Google Calendar'}
          </button>
</div>
       </div>


       <section
         className="event-card"
         style={{ marginBottom: '2rem' }}
       >
         <h2 style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '0.35rem' }}>
           Upload Syllabus
         </h2>
         <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
           Upload a course syllabus PDF and Compass will extract exams, assignments, and deadlines.
         </p>

         <form
           onSubmit={handleSyllabusUpload}
           style={{ display: 'grid', gap: '1rem' }}
         >
           <label style={{ display: 'grid', gap: '0.45rem' }}>
             <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Syllabus PDF</span>
             <input
               type="file"
               accept="application/pdf,.pdf"
               onChange={(e) => setSyllabusFile(e.target.files?.[0] || null)}
               style={{
                 width: '100%',
                 padding: '0.75rem 1rem',
                 borderRadius: '12px',
                 border: '1px solid var(--border)',
                 background: 'var(--bg-surface)',
                 color: 'var(--text)',
                 fontSize: '0.95rem',
               }}
             />
           </label>

           <label style={{ display: 'grid', gap: '0.45rem' }}>
             <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Course Name</span>
             <input
               type="text"
               value={courseName}
               onChange={(e) => setCourseName(e.target.value)}
               placeholder="e.g. Introduction to Computer Science"
               style={{
                 width: '100%',
                 padding: '0.75rem 1rem',
                 borderRadius: '12px',
                 border: '1px solid var(--border)',
                 background: 'var(--bg-surface)',
                 color: 'var(--text)',
                 fontSize: '0.95rem',
               }}
             />
           </label>

           <label style={{ display: 'grid', gap: '0.45rem' }}>
             <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Course Code</span>
             <input
               type="text"
               value={courseCode}
               onChange={(e) => setCourseCode(e.target.value)}
               placeholder="e.g. CSE 131"
               style={{
                 width: '100%',
                 padding: '0.75rem 1rem',
                 borderRadius: '12px',
                 border: '1px solid var(--border)',
                 background: 'var(--bg-surface)',
                 color: 'var(--text)',
                 fontSize: '0.95rem',
               }}
             />
           </label>

           <button
             type="submit"
             className="btn btn-outline"
             disabled={syllabusLoading || loading}
             style={{ justifySelf: 'start' }}
           >
             {syllabusLoading ? 'Scanning syllabus with AI...' : 'Upload'}
           </button>
         </form>

         {syllabusError && (
           <div className="error-banner" style={{ marginTop: '1rem', marginBottom: 0 }}>
             {syllabusError}
           </div>
         )}

         {syllabusMessage && !syllabusLoading && (
           <p
             style={{
               color: 'var(--accent-soft)',
               fontSize: '0.9rem',
               marginTop: '1rem',
               marginBottom: 0,
             }}
           >
             {syllabusMessage}
           </p>
         )}
       </section>


       {error && <div className="error-banner">{error}</div>}
       {syncMessage && (
        <p style={{ color: 'var(--accent-soft)', fontSize: '0.9rem', marginBottom: '1rem' }}>
          {syncMessage}
        </p>
        )}

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


       {pendingLoading && !loading && (
         <div className="loading-block">
           <div className="spinner" />
           <p>Loading events…</p>
         </div>
       )}


       {!loading && !pendingLoading && pendingEvents.length === 0 && !error && (
         <div className="empty-state">
           <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
             No events yet
           </p>
           <p>Click &quot;Scan My Emails&quot; or &quot;Scan Outlook&quot; to find scheduling info in your inbox.</p>
         </div>
       )}


       {!loading &&
         !pendingLoading &&
         pendingEvents.map((event) => {
           const isActing = actionPendingId === event.id;

           return (
             <article key={event.id} className="event-card">
               <div className="event-card-header">
                 <h2 className="event-title">{event.title || 'Untitled event'}</h2>
                 <div className="event-meta">
                   <PriorityStars priority={event.priority} />
                   <span className="badge">{event.scheduling_type || 'other'}</span>
                 </div>
               </div>


               {event.location && (
                 <p className="event-detail">📍 {event.location}</p>
               )}
               {event.raw_date && (
                 <p className="event-detail">🗓 {event.raw_date}</p>
               )}
               {event.event_time && (
                 <p className="event-detail">🕐 {event.event_time}</p>
               )}


               {event.description && (
                 <p className="event-reasoning">{event.description}</p>
               )}

               <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                 <button
                   type="button"
                   className="btn btn-primary"
                   onClick={() => handleApprove(event.id)}
                   disabled={isActing}
                 >
                   {isActing ? 'Working…' : '✓ Approve'}
                 </button>
                 <button
                   type="button"
                   className="btn btn-outline"
                   onClick={() => handleReject(event.id)}
                   disabled={isActing}
                 >
                   {isActing ? 'Working…' : '✗ Reject'}
                 </button>
               </div>
             </article>
           );
         })}
     </main>
   </div>
 );
}


export default Dashboard;

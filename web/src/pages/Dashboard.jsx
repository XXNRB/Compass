import { useState, useEffect } from 'react';
import axios from 'axios';
import AppHeader from '../components/AppHeader.jsx';
import Icon from '../components/Icon.jsx';
import { PriorityTag } from '../components/Priority.jsx';
import { AccountTag, EmailFilter, useEmailFilter } from '../components/EmailFilter.jsx';
import { API_BASE, authUrl } from '../api.js';


// Gmail's /u/<n>/ is the account's position in the browser's Google sign-in
// list (0 = first signed in), not something the API can tell us, so it's
// mapped by address here. Unlisted accounts default to the first one.
const GMAIL_ACCOUNT_INDEX = {
 'kofidadzieyeboah@gmail.com': 0,
 'kofidy15@gmail.com': 1,
};

// #all/ finds the thread wherever it is (inbox, archived, labeled); #inbox/
// 404s once a thread leaves the inbox. Without a thread id, search Gmail for
// the event title instead.
function gmailEmailUrl(event) {
 const index = GMAIL_ACCOUNT_INDEX[event.source_email] ?? 0;
 const base = `https://mail.google.com/mail/u/${index}/`;
 if (event.thread_id) {
   return `${base}#all/${event.thread_id}`;
 }
 return `${base}#search/${encodeURIComponent(event.title || '')}`;
}


// A failed scan can mean three different things, and the fix differs for each:
// no response at all (server down or blocked), 401 (no live login for that
// provider), or a server-side error that carries its own message.
function describeScanError(err, label) {
 if (!err.response) {
   return {
     message: 'Could not reach the Compass server. Check that the backend is running.',
     needsConnect: false,
   };
 }

 if (err.response.status === 401) {
   return {
     message: `${label} is not connected for this session.`,
     needsConnect: true,
   };
 }

 return {
   message:
     err.response.data?.error ||
     err.response.data?.message ||
     `Scan failed (server error ${err.response.status}). Check that the backend is running.`,
   needsConnect: false,
 };
}


function Spinner() {
 return <span className="spinner" aria-hidden="true" />;
}


function Field({ label, children }) {
 return (
   <label className="field">
     <span className="field-label">{label}</span>
     {children}
   </label>
 );
}


function Notice({ tone, children, inline = false }) {
 return (
   <div className={`notice notice--${tone}${inline ? ' notice--inline' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
     <Icon name={tone === 'error' ? 'alert' : 'check'} />
     <span>{children}</span>
   </div>
 );
}


function Dashboard() {
 const [userEmail, setUserEmail] = useState('');
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState(null);
 const [reconnect, setReconnect] = useState(null);
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
 const [canvasUrl, setCanvasUrl] = useState('');
 const [canvasToken, setCanvasToken] = useState('');
 const [canvasConnected, setCanvasConnected] = useState(false);
 const [canvasConnectedUrl, setCanvasConnectedUrl] = useState(null);
 const [showCanvasForm, setShowCanvasForm] = useState(false);
 const [canvasConnectLoading, setCanvasConnectLoading] = useState(false);
 const [canvasConnectError, setCanvasConnectError] = useState(null);
 const [canvasSyncLoading, setCanvasSyncLoading] = useState(false);
 const [canvasSyncMessage, setCanvasSyncMessage] = useState(null);
 const [canvasSyncError, setCanvasSyncError] = useState(null);
 const [homeAddress, setHomeAddress] = useState('');
 const [travelMode, setTravelMode] = useState('driving');
 const [prefsSaveLoading, setPrefsSaveLoading] = useState(false);
 const [prefsSaveMessage, setPrefsSaveMessage] = useState(null);
 const [prefsSaveError, setPrefsSaveError] = useState(null);
 const [approveMessage, setApproveMessage] = useState(null);
 const [dedupeLoading, setDedupeLoading] = useState(false);
 const [dedupeMessage, setDedupeMessage] = useState(null);
 const [linkMessage, setLinkMessage] = useState(null);
 const emailFilter = useEmailFilter(pendingEvents);
 const visibleEvents = pendingEvents.filter(emailFilter.isVisible);

 // Preview first, then confirm: removal is permanent.
 async function handleRemoveDuplicates() {
   setDedupeLoading(true);
   setDedupeMessage(null);
   setError(null);
   setReconnect(null);

   try {
     const userId = localStorage.getItem('compassUserId') || '';
     const url = `${API_BASE}/events/deduplicate?userId=${userId}`;
     const plural = (n) => `${n} duplicate event${n !== 1 ? 's' : ''}`;

     const { data: preview } = await axios.get(`${url}&dryRun=true`, { withCredentials: true });
     if (!preview.removed) {
       setDedupeMessage('No duplicate events found.');
       return;
     }

     const confirmed = window.confirm(
       `Found ${plural(preview.removed)} in ${preview.groups.length} group${preview.groups.length !== 1 ? 's' : ''}. Remove them and keep the most detailed copy of each?`,
     );
     if (!confirmed) return;

     const { data } = await axios.get(url, { withCredentials: true });
     setDedupeMessage(`Removed ${plural(data.removed)}.`);
     await fetchPendingEvents();
   } catch (err) {
     const message =
       err.response?.data?.error ||
       err.response?.data?.message ||
       'Failed to remove duplicate events.';
     setError(message);
   } finally {
     setDedupeLoading(false);
   }
 }

 async function fetchPreferences() {
   try {
     const userId = localStorage.getItem('compassUserId') || '';
     const { data } = await axios.get(`${API_BASE}/preferences?userId=${userId}`, {
       withCredentials: true,
     });
     setHomeAddress(data.home_address || '');
     setTravelMode(data.travel_mode || 'driving');
   } catch (err) {
     // Non-fatal: leave the defaults in place.
   }
 }

 async function handleSavePreferences(event) {
   event.preventDefault();
   setPrefsSaveLoading(true);
   setPrefsSaveError(null);
   setPrefsSaveMessage(null);

   try {
     const userId = localStorage.getItem('compassUserId') || '';
     await axios.post(
       `${API_BASE}/preferences`,
       { homeAddress, travelMode, userId },
       { withCredentials: true },
     );
     setPrefsSaveMessage('Preferences saved.');
   } catch (err) {
     const message =
       err.response?.data?.error ||
       err.response?.data?.message ||
       'Failed to save preferences.';
     setPrefsSaveError(message);
   } finally {
     setPrefsSaveLoading(false);
   }
 }

 function formatDepartureTime(isoString) {
   if (!isoString) return null;
   const date = new Date(isoString);
   if (Number.isNaN(date.getTime())) return null;
   const hours = date.getHours();
   const minutes = String(date.getMinutes()).padStart(2, '0');
   const suffix = hours >= 12 ? 'PM' : 'AM';
   const hour12 = hours % 12 || 12;
   return `${hour12}:${minutes} ${suffix}`;
 }

 async function fetchCanvasStatus() {
   try {
     const userId = localStorage.getItem('compassUserId') || '';
     const { data } = await axios.get(`${API_BASE}/canvas/status?userId=${userId}`, {
       withCredentials: true,
     });
     setCanvasConnected(!!data.connected);
     setCanvasConnectedUrl(data.canvasUrl || null);
   } catch (err) {
     // Non-fatal: leave the connect form available.
   }
 }

 async function handleCanvasConnect(event) {
   event.preventDefault();
   setCanvasConnectLoading(true);
   setCanvasConnectError(null);

   try {
     const userId = localStorage.getItem('compassUserId') || '';
     const { data } = await axios.post(
       `${API_BASE}/canvas/connect`,
       { canvasUrl, canvasToken, userId },
       { withCredentials: true },
     );
     setCanvasConnected(true);
     setCanvasConnectedUrl(data.canvasUrl);
     setShowCanvasForm(false);
     setCanvasToken('');
   } catch (err) {
     const message =
       err.response?.data?.error ||
       err.response?.data?.message ||
       'Could not connect to Canvas. Check your URL and API token.';
     setCanvasConnectError(message);
   } finally {
     setCanvasConnectLoading(false);
   }
 }

 async function handleCanvasSync() {
   setCanvasSyncLoading(true);
   setCanvasSyncError(null);
   setCanvasSyncMessage(null);

   try {
     const userId = localStorage.getItem('compassUserId') || '';
     const { data } = await axios.post(
       `${API_BASE}/canvas/sync`,
       { userId },
       { withCredentials: true },
     );
     setCanvasSyncMessage(
       `Found ${data.assignmentsFound} assignment${data.assignmentsFound !== 1 ? 's' : ''} across ${data.coursesFound} course${data.coursesFound !== 1 ? 's' : ''} — ${data.imported} new`,
     );
     await fetchPendingEvents();
   } catch (err) {
     const message =
       err.response?.data?.error ||
       err.response?.data?.message ||
       'Failed to sync Canvas assignments.';
     setCanvasSyncError(message);
   } finally {
     setCanvasSyncLoading(false);
   }
 }

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
   // Back from "Add another email"
   const linkedEmail = params.get('linked');
   const linkError = params.get('linkError');
   if (linkedEmail || linkError) {
     setLinkMessage(
       linkedEmail
         ? { tone: 'success', text: `Connected ${linkedEmail}. Scan Gmail to pull in its events.` }
         : {
             tone: 'error',
             text: linkError === 'session'
               ? 'Your session expired. Sign in with Google again, then add the other account.'
               : 'Could not save that Google account. Please try again.',
           },
     );
     window.history.replaceState({}, '', '/dashboard');
   }
   fetchPendingEvents();
   fetchCanvasStatus();
   fetchPreferences();
 }, []);

 async function handleApprove(id) {
   setActionPendingId(id);
   setApproveMessage(null);
   try {
     const userId = localStorage.getItem('compassUserId') || '';
     const { data } = await axios.patch(
       `${API_BASE}/events/${id}?userId=${userId}`,
       { status: 'approved' },
       { withCredentials: true },
     );
     setPendingEvents((prev) => prev.filter((event) => event.id !== id));
     const departureTime = formatDepartureTime(data.event?.departure_time);
     setApproveMessage(departureTime ? `Approved. Depart by ${departureTime}.` : 'Approved.');
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

 // Optimistic: flip the checkbox now, roll back if the save fails.
 async function handleToggleActionItem(eventId, index, done) {
   const setDone = (value) =>
     setPendingEvents((prev) =>
       prev.map((event) =>
         event.id === eventId
           ? {
               ...event,
               action_items: event.action_items.map((item, i) =>
                 i === index ? { ...item, done: value } : item,
               ),
             }
           : event,
       ),
     );

   setDone(done);
   try {
     const userId = localStorage.getItem('compassUserId') || '';
     await axios.patch(
       `${API_BASE}/events/${eventId}/action-items?userId=${userId}`,
       { index, done },
       { withCredentials: true },
     );
   } catch (err) {
     setDone(!done);
     const message =
       err.response?.data?.error ||
       err.response?.data?.message ||
       'Failed to update action item.';
     setError(message);
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
   setReconnect(null);
   setScanMeta(null);


   try {
     const { data } = await axios.get(`${API_BASE}/emails/scan`, {
       withCredentials: true,
     });


     setScanMeta({ total: data.total, saved: data.saved });
     if (data.failedAccounts?.length) {
       setError(`Could not scan ${data.failedAccounts.join(', ')}. Try reconnecting ${data.failedAccounts.length > 1 ? 'those accounts' : 'that account'}.`);
     }
     await fetchPendingEvents();
   } catch (err) {
     const { message, needsConnect } = describeScanError(err, 'Gmail');
     setError(message);
     setReconnect(needsConnect ? { provider: 'google', label: 'Gmail' } : null);
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
   setReconnect(null);

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
     const { message, needsConnect } = describeScanError(err, 'Outlook');
     setError(message);
     setReconnect(needsConnect ? { provider: 'microsoft', label: 'Outlook' } : null);
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
     const skipped = data.skippedDuplicates ?? 0;
     setSyllabusMessage(
       `Found ${total} event${total !== 1 ? 's' : ''} — ${googleCalendarAdded} added to Google Calendar`
       + (skipped ? `, ${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped` : ''),
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
     <AppHeader userEmail={userEmail} />

     <main className="container main">
       <div className="page-head">
         <div>
           <h1 className="page-title">Dashboard</h1>
           <p className="page-subtitle">
             Review the events Compass has detected from your email, syllabi, and Canvas.
           </p>
         </div>
         <div className="toolbar">
           <button
             type="button"
             className="btn btn-primary"
             onClick={handleScan}
             disabled={loading}
           >
             {loading && <Spinner />}
             {loading ? 'Scanning' : 'Scan Gmail'}
           </button>
           <button
             type="button"
             className="btn btn-outline"
             onClick={handleScanOutlook}
             disabled={outlookLoading}
           >
             {outlookLoading && <Spinner />}
             {outlookLoading ? 'Scanning' : 'Scan Outlook'}
           </button>
           <button
             type="button"
             className="btn btn-outline"
             onClick={handleGoogleCalendarSync}
             disabled={syncLoading}
           >
             {syncLoading && <Spinner />}
             {syncLoading ? 'Syncing' : 'Sync Google Calendar'}
           </button>
           <button
             type="button"
             className="btn btn-outline"
             onClick={handleRemoveDuplicates}
             disabled={dedupeLoading}
           >
             {dedupeLoading && <Spinner />}
             {dedupeLoading ? 'Checking' : 'Remove Duplicates'}
           </button>
         </div>
       </div>

       {error && (
         <Notice tone="error">
           {error}
           {reconnect && (
             <>
               {' '}
               <a href={authUrl(reconnect.provider)}>Connect {reconnect.label}</a>
             </>
           )}
         </Notice>
       )}
       {linkMessage && <Notice tone={linkMessage.tone}>{linkMessage.text}</Notice>}
       {approveMessage && <Notice tone="success">{approveMessage}</Notice>}
       {syncMessage && <Notice tone="success">{syncMessage}</Notice>}
       {dedupeMessage && <Notice tone="success">{dedupeMessage}</Notice>}
       {scanMeta && !loading && (
         <Notice tone="success">
           Found {scanMeta.total} event{scanMeta.total !== 1 ? 's' : ''}
           {typeof scanMeta.saved === 'number' && ` · ${scanMeta.saved} saved to database`}
         </Notice>
       )}

       <EmailFilter filter={emailFilter} />

       <div className="dash-grid">
         {/* --- Pending events --- */}
         <section aria-labelledby="pending-heading">
           <h2 id="pending-heading" className="section-label">
             Pending review
             {!pendingLoading && <span className="count">{visibleEvents.length}</span>}
           </h2>

           {loading && (
             <div className="loading-block">
               <Spinner />
               <span>Scanning your inbox with AI</span>
             </div>
           )}

           {pendingLoading && !loading && (
             <div className="loading-block">
               <Spinner />
               <span>Loading events</span>
             </div>
           )}

           {!loading && !pendingLoading && pendingEvents.length === 0 && !error && (
             <div className="empty-state">
               <strong>Nothing to review</strong>
               Scan Gmail or Outlook to find scheduling info in your inbox.
             </div>
           )}

           {!loading && !pendingLoading && pendingEvents.length > 0 && visibleEvents.length === 0 && (
             <div className="empty-state">
               <strong>All events are filtered out</strong>
               {pendingEvents.length} pending event{pendingEvents.length !== 1 ? 's are' : ' is'} hidden by the account filter above.
             </div>
           )}

           {!loading && !pendingLoading && visibleEvents.length > 0 && (
             <div className="event-list">
               {visibleEvents.map((event) => {
                 const isActing = actionPendingId === event.id;

                 return (
                   <article key={event.id} className="event-card">
                     <div className="event-card-header">
                       <h3 className="event-title">{event.title || 'Untitled event'}</h3>
                       <div className="event-tags">
                         <PriorityTag priority={event.priority} />
                         <span className="tag">{event.scheduling_type || 'other'}</span>
                       </div>
                     </div>

                     <AccountTag email={event.source_email} color={emailFilter.colorFor(event.source_email)} />

                     {(event.raw_date || event.event_time || event.location) && (
                       <div className="event-facts">
                         {event.raw_date && (
                           <p className="fact">
                             <Icon name="calendar" />
                             {event.raw_date}
                           </p>
                         )}
                         {event.event_time && (
                           <p className="fact">
                             <Icon name="clock" />
                             {event.event_time}
                           </p>
                         )}
                         {event.location && (
                           <p className="fact">
                             <Icon name="pin" />
                             {event.location}
                           </p>
                         )}
                       </div>
                     )}

                     {event.description && (
                       <p className="event-description">{event.description}</p>
                     )}

                     {event.topics && (
                       <p className="event-topics">
                         <span className="event-subhead">Covers</span>
                         {event.topics}
                       </p>
                     )}

                     {Array.isArray(event.action_items) && event.action_items.length > 0 && (
                       <div className="action-items">
                         <span className="event-subhead">
                           Action items
                           <span className="action-items-count">
                             {event.action_items.filter((item) => item.done).length}/{event.action_items.length}
                           </span>
                         </span>
                         <ul className="checklist">
                           {event.action_items.map((item, index) => (
                             <li key={index}>
                               <label className={`checklist-item${item.done ? ' is-done' : ''}`}>
                                 <input
                                   type="checkbox"
                                   checked={!!item.done}
                                   onChange={(e) => handleToggleActionItem(event.id, index, e.target.checked)}
                                 />
                                 <span>{item.text}</span>
                               </label>
                             </li>
                           ))}
                         </ul>
                       </div>
                     )}

                     {event.source === 'gmail' && (event.thread_id || event.title) && (
                       <a
                         className="event-link"
                         href={gmailEmailUrl(event)}
                         target="_blank"
                         rel="noopener noreferrer"
                       >
                         View original email
                       </a>
                     )}

                     <div className="event-actions">
                       <button
                         type="button"
                         className="btn btn-primary"
                         onClick={() => handleApprove(event.id)}
                         disabled={isActing}
                       >
                         <Icon name="check" />
                         {isActing ? 'Working' : 'Approve'}
                       </button>
                       <button
                         type="button"
                         className="btn btn-outline btn-danger-ghost"
                         onClick={() => handleReject(event.id)}
                         disabled={isActing}
                       >
                         <Icon name="x" />
                         {isActing ? 'Working' : 'Reject'}
                       </button>
                     </div>
                   </article>
                 );
               })}
             </div>
           )}
         </section>

         {/* --- Sources & settings --- */}
         <aside className="stack" aria-label="Sources and settings">
           <section className="card">
             <h2 className="card-title">Email accounts</h2>
             <p className="card-desc">
               Scan Gmail checks every connected Gmail account.
             </p>

             {emailFilter.accounts.length > 0 ? (
               <ul className="account-list">
                 {emailFilter.accounts.map((account) => (
                   <li key={account.email} className="account-row">
                     <span className="account-dot" style={{ background: account.color }} aria-hidden="true" />
                     <span className="account-email">{account.email}</span>
                     <span className="tag">{account.provider === 'outlook' ? 'Outlook' : 'Gmail'}</span>
                   </li>
                 ))}
               </ul>
             ) : (
               <p className="card-desc">No accounts connected yet.</p>
             )}

             <div className="form-actions">
               <a className="btn btn-outline" href={`${authUrl('google')}&link=1`}>
                 Add another email
               </a>
             </div>
           </section>

           <section className="card">
             <h2 className="card-title">Upload syllabus</h2>
             <p className="card-desc">
               Compass extracts exams, assignments, and deadlines from a course syllabus PDF.
             </p>

             <form onSubmit={handleSyllabusUpload} className="form">
               <Field label="Syllabus PDF">
                 <input
                   type="file"
                   className="input"
                   accept="application/pdf,.pdf"
                   onChange={(e) => setSyllabusFile(e.target.files?.[0] || null)}
                 />
               </Field>

               <Field label="Course name">
                 <input
                   type="text"
                   className="input"
                   value={courseName}
                   onChange={(e) => setCourseName(e.target.value)}
                   placeholder="Introduction to Computer Science"
                 />
               </Field>

               <Field label="Course code">
                 <input
                   type="text"
                   className="input"
                   value={courseCode}
                   onChange={(e) => setCourseCode(e.target.value)}
                   placeholder="CSE 131"
                 />
               </Field>

               <div className="form-actions">
                 <button
                   type="submit"
                   className="btn btn-outline"
                   disabled={syllabusLoading || loading}
                 >
                   {syllabusLoading && <Spinner />}
                   {syllabusLoading ? 'Scanning syllabus' : 'Upload'}
                 </button>
               </div>
             </form>

             {syllabusError && <Notice tone="error" inline>{syllabusError}</Notice>}
             {syllabusMessage && !syllabusLoading && (
               <Notice tone="success" inline>{syllabusMessage}</Notice>
             )}
           </section>

           <section className="card">
             <h2 className="card-title">Canvas</h2>
             <p className="card-desc">
               Pull assignment due dates from your school&apos;s Canvas automatically.
             </p>

             {canvasConnected && !showCanvasForm ? (
               <div>
                 <p className="connected-row">
                   <span className="status-dot" aria-hidden="true" />
                   <span>Connected to <strong>{canvasConnectedUrl}</strong></span>
                 </p>
                 <div className="form-actions">
                   <button
                     type="button"
                     className="btn btn-primary"
                     onClick={handleCanvasSync}
                     disabled={canvasSyncLoading}
                   >
                     {canvasSyncLoading && <Spinner />}
                     {canvasSyncLoading ? 'Syncing' : 'Sync assignments'}
                   </button>
                   <button
                     type="button"
                     className="btn btn-outline"
                     onClick={() => setShowCanvasForm(true)}
                   >
                     Change token
                   </button>
                 </div>

                 {canvasSyncError && <Notice tone="error" inline>{canvasSyncError}</Notice>}
                 {canvasSyncMessage && !canvasSyncLoading && (
                   <Notice tone="success" inline>{canvasSyncMessage}</Notice>
                 )}
               </div>
             ) : (
               <form onSubmit={handleCanvasConnect} className="form">
                 <Field label="School Canvas URL">
                   <input
                     type="text"
                     className="input"
                     value={canvasUrl}
                     onChange={(e) => setCanvasUrl(e.target.value)}
                     placeholder="yourschool.instructure.com"
                   />
                 </Field>

                 <Field label="API token">
                   <input
                     type="password"
                     className="input"
                     value={canvasToken}
                     onChange={(e) => setCanvasToken(e.target.value)}
                     placeholder="Paste your personal access token"
                   />
                 </Field>

                 <div className="form-actions">
                   <button
                     type="submit"
                     className="btn btn-outline"
                     disabled={canvasConnectLoading}
                   >
                     {canvasConnectLoading && <Spinner />}
                     {canvasConnectLoading ? 'Connecting' : 'Connect Canvas'}
                   </button>
                   {canvasConnected && (
                     <button
                       type="button"
                       className="btn btn-ghost"
                       onClick={() => setShowCanvasForm(false)}
                     >
                       Cancel
                     </button>
                   )}
                 </div>
               </form>
             )}

             {canvasConnectError && <Notice tone="error" inline>{canvasConnectError}</Notice>}
           </section>

           <section className="card">
             <h2 className="card-title">Travel preferences</h2>
             <p className="card-desc">
               Compass uses these to recommend when to leave for approved events.
             </p>

             <form onSubmit={handleSavePreferences} className="form">
               <Field label="Home address">
                 <input
                   type="text"
                   className="input"
                   value={homeAddress}
                   onChange={(e) => setHomeAddress(e.target.value)}
                   placeholder="1 Brookings Dr, St. Louis, MO"
                 />
               </Field>

               <Field label="Preferred travel mode">
                 <select
                   className="select"
                   value={travelMode}
                   onChange={(e) => setTravelMode(e.target.value)}
                 >
                   <option value="driving">Driving</option>
                   <option value="walking">Walking</option>
                   <option value="transit">Transit</option>
                   <option value="bicycling">Bicycling</option>
                 </select>
               </Field>

               <div className="form-actions">
                 <button
                   type="submit"
                   className="btn btn-outline"
                   disabled={prefsSaveLoading}
                 >
                   {prefsSaveLoading && <Spinner />}
                   {prefsSaveLoading ? 'Saving' : 'Save preferences'}
                 </button>
               </div>
             </form>

             {prefsSaveError && <Notice tone="error" inline>{prefsSaveError}</Notice>}
             {prefsSaveMessage && !prefsSaveLoading && (
               <Notice tone="success" inline>{prefsSaveMessage}</Notice>
             )}
           </section>
         </aside>
       </div>
     </main>
   </div>
 );
}


export default Dashboard;

const API_BASE = 'http://localhost:3000/api';


const FEATURES = [
 {
   icon: '📅',
   title: 'Smart Scheduling',
   description:
     'AI scans your inbox and surfaces meetings, deadlines, and events automatically.',
 },
 {
   icon: '🗺️',
   title: 'Academic Roadmap',
   description:
     'Plan your degree path with intelligent course sequencing and milestone tracking.',
 },
 {
   icon: '🏠',
   title: 'Housing Intelligence',
   description:
     'Compare dorms and off-campus options with insights tailored to your campus.',
 },
 {
   icon: '🚀',
   title: 'Career Navigator',
   description:
     'Discover internships and roles aligned with your major and interests.',
 },
 {
   icon: '📝',
   title: 'Note Taking',
   description:
     'Capture lectures and study sessions with smart organization and search.',
 },
];


function Landing() {
 return (
   <div className="page">
     {/* --- Navigation --- */}
     <nav
       style={{
         padding: '1.25rem 0',
         borderBottom: '1px solid var(--border)',
       }}
     >
       <div
         className="container"
         style={{
           display: 'flex',
           alignItems: 'center',
           justifyContent: 'space-between',
         }}
       >
         <span
           style={{
             fontSize: '1.25rem',
             fontWeight: 700,
             background: 'var(--gradient-hero)',
             WebkitBackgroundClip: 'text',
             WebkitTextFillColor: 'transparent',
           }}
         >
           Compass
         </span>
         <a href="/dashboard" className="btn btn-ghost">
           Dashboard →
         </a>
       </div>
     </nav>


     {/* --- Hero --- */}
     <header
       style={{
         padding: '6rem 0 5rem',
         textAlign: 'center',
       }}
     >
       <div className="container">
         <p
           style={{
             fontSize: '0.85rem',
             fontWeight: 600,
             letterSpacing: '0.12em',
             textTransform: 'uppercase',
             color: 'var(--accent-soft)',
             marginBottom: '1rem',
           }}
         >
           College companion
         </p>
         <h1
           style={{
             fontSize: 'clamp(3rem, 8vw, 4.5rem)',
             fontWeight: 800,
             letterSpacing: '-0.03em',
             lineHeight: 1.1,
             marginBottom: '1rem',
             background: 'var(--gradient-hero)',
             WebkitBackgroundClip: 'text',
             WebkitTextFillColor: 'transparent',
           }}
         >
           Compass
         </h1>
         <p
           style={{
             fontSize: '1.25rem',
             color: 'var(--text-muted)',
             maxWidth: 520,
             margin: '0 auto 2.5rem',
           }}
         >
           Your AI-powered college companion
         </p>


         <div
           style={{
             display: 'flex',
             flexWrap: 'wrap',
             gap: '1rem',
             justifyContent: 'center',
           }}
         >
           <a href={`${API_BASE}/auth/google`} className="btn btn-primary">
             Connect Gmail
           </a>
           <a href={`${API_BASE}/auth/microsoft`} className="btn btn-outline">
             Connect Outlook
           </a>
         </div>
       </div>
     </header>


     {/* --- Features --- */}
     <section
       style={{
         padding: '4rem 0 6rem',
         background: 'var(--bg-surface)',
         borderTop: '1px solid var(--border)',
       }}
     >
       <div className="container">
         <h2
           style={{
             textAlign: 'center',
             fontSize: '1.75rem',
             fontWeight: 700,
             marginBottom: '0.5rem',
           }}
         >
           Everything you need for campus life
         </h2>
         <p
           style={{
             textAlign: 'center',
             color: 'var(--text-muted)',
             marginBottom: '2.5rem',
           }}
         >
           One platform to stay organized, on track, and ahead.
         </p>


         <div
           style={{
             display: 'grid',
             gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
             gap: '1.25rem',
           }}
         >
           {FEATURES.map((feature) => (
             <article key={feature.title} className="card">
               <div className="card-icon">{feature.icon}</div>
               <h3>{feature.title}</h3>
               <p>{feature.description}</p>
             </article>
           ))}
         </div>
       </div>
     </section>


     {/* --- Footer --- */}
     <footer
       style={{
         padding: '2rem 0',
         borderTop: '1px solid var(--border)',
         textAlign: 'center',
         color: 'var(--text-muted)',
         fontSize: '0.875rem',
       }}
     >
       <div className="container">© {new Date().getFullYear()} Compass</div>
     </footer>
   </div>
 );
}


export default Landing;

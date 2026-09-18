import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { PriorityTag } from '../components/Priority.jsx';
import { authUrl } from '../api.js';


const FEATURES = [
 {
   icon: 'calendar',
   title: 'Smart Scheduling',
   description:
     'AI scans your inbox and surfaces meetings, deadlines, and events automatically.',
 },
 {
   icon: 'map',
   title: 'Academic Roadmap',
   description:
     'Plan your degree path with intelligent course sequencing and milestone tracking.',
 },
 {
   icon: 'home',
   title: 'Housing Intelligence',
   description:
     'Compare dorms and off-campus options with insights tailored to your campus.',
 },
 {
   icon: 'briefcase',
   title: 'Career Navigator',
   description:
     'Discover internships and roles aligned with your major and interests.',
 },
 {
   icon: 'note',
   title: 'Note Taking',
   description:
     'Capture lectures and study sessions with smart organization and search.',
 },
];


function Landing() {
 return (
   <div className="page">
     <nav className="landing-nav">
       <div className="container">
         <span className="brand">
           <Icon name="compass" />
           Compass
         </span>
         <Link to="/dashboard" className="btn btn-outline">
           Open dashboard
         </Link>
       </div>
     </nav>

     <header className="hero">
       <div className="container">
         <span className="eyebrow">Your college companion</span>
         <h1 className="hero-title">
           Every deadline, event, and class in one place.
         </h1>
         <p className="hero-sub">
           Compass reads your email and syllabi, finds what matters, and tells you
           when to leave.
         </p>

         <div className="hero-actions">
           <a href={authUrl('google')} className="btn btn-primary btn-lg">
             Connect Gmail
           </a>
           <a href={authUrl('microsoft')} className="btn btn-outline btn-lg">
             Connect Outlook
           </a>
         </div>

         <div className="preview" aria-hidden="true">
           <article className="event-card">
             <div className="event-card-header">
               <h3 className="event-title">New student orientation</h3>
               <div className="event-tags">
                 <PriorityTag priority={4} />
                 <span className="tag">event</span>
               </div>
             </div>
             <div className="event-facts">
               <p className="fact">
                 <Icon name="calendar" />
                 August 24, 2026
               </p>
               <p className="fact">
                 <Icon name="clock" />
                 9:00 AM
               </p>
               <p className="fact">
                 <Icon name="pin" />
                 Student Union Ballroom
               </p>
             </div>
           </article>
         </div>
       </div>
     </header>

     <section className="features">
       <div className="container">
         <div className="features-head">
           <h2 className="features-title">Everything you need for campus life</h2>
           <p className="features-sub">
             One platform to stay organized, on track, and ahead.
           </p>
         </div>

         <div className="feature-grid">
           {FEATURES.map((feature) => (
             <article key={feature.title} className="feature">
               <div className="feature-icon">
                 <Icon name={feature.icon} />
               </div>
               <h3>{feature.title}</h3>
               <p>{feature.description}</p>
             </article>
           ))}
         </div>
       </div>
     </section>

     <footer className="footer">
       <div className="container">&copy; {new Date().getFullYear()} Compass</div>
     </footer>
   </div>
 );
}


export default Landing;

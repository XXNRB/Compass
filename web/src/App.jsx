import { Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Calendar from './pages/Calendar.jsx';
import NotFound from './pages/NotFound.jsx';


function App() {
 return (
   <Routes>
     <Route path="/" element={<Landing />} />
     <Route path="/dashboard" element={<Dashboard />} />
     <Route path="/calendar" element={<Calendar />} />
     <Route path="*" element={<NotFound />} />
   </Routes>
 );
}


export default App;

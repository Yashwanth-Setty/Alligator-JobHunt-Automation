import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import Dashboard from './pages/Dashboard';
import JobHunt from './pages/JobHunt';
import Applications from './pages/Applications';
import JobStatistics from './pages/JobStatistics';
import Settings from './pages/Settings';
import CareerCopilot from './pages/CareerCopilot';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/job-hunt" element={<JobHunt />} />
          <Route path="/applications" element={<Applications />} />
          <Route path="/analytics" element={<JobStatistics />} />
          <Route path="/copilot" element={<CareerCopilot />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/statistics" element={<Navigate to="/analytics" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

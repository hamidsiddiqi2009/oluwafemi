import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import TimeTracker from './components/TimeTracker';
import ChatWidget from './components/ChatWidget';
import AdminPage from './components/AdminPage';

const App = () => (
  <Router>
    <Routes>
      <Route path="/" element={<TimeTracker />} />
      <Route path="/chat" element={<ChatWidget />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  </Router>
);

export default App;

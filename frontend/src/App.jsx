import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import TimeTracker from './components/TimeTracker';
import ChatWidget from './components/ChatWidget';

const App = () => (
  <Router>
    <Routes>
      <Route path="/" element={<TimeTracker />} />
      <Route path="/chat" element={<ChatWidget />} />
    </Routes>
  </Router>
);

export default App;

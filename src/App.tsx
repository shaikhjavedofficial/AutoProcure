import React from 'react';
import { Routes, Route } from 'react-router-dom';
import AgentUI from './Components/AgentUI';
import NotFound from './Components/NotFound';

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<AgentUI />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default App;
import React, { useState, useEffect, useRef } from 'react';

const AgentUI: React.FC = () => {
  // Main Agent State
  const [url, setUrl] = useState('https://www.amazon.com/');
  const [goal, setGoal] = useState('Log into Amazon. If you encounter an OTP screen, PAUSE and ask the user for input. Search for "Logitech MX Master 3S", extract the top 3 prices, and return the data.');
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Human-in-the-Loop (HITL) State
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [requiresInput, setRequiresInput] = useState(false);
  const [userInput, setUserInput] = useState('');

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const runAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setLogs([]);
    setResult(null);
    setRequiresInput(false);
    setActiveJobId(null);

    try {
      // 1. Dispatch the job
      const response = await fetch('http://localhost:8000/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, goal }),
      });

      if (!response.ok) throw new Error('Failed to dispatch job');
      
      const data = await response.json();
      const jobId = data.job_id;
      
      setActiveJobId(jobId); // Save this so we can send OTPs to the right job
      setLogs((prev) => [...prev, `🚀 Job dispatched. ID: ${jobId}`]);

      // 2. Open the WebSocket listener
      const ws = new WebSocket(`ws://localhost:8000/ws/agent/${jobId}`);
      wsRef.current = ws;

      ws.onopen = () => setLogs((prev) => [...prev, '🔌 Connected to live cloud stream...']);

      ws.onmessage = (event) => {
        try {
          const eventData = JSON.parse(event.data);
          
          if (eventData.type === 'SYSTEM' || eventData.type === 'PROGRESS') {
            setLogs((prev) => [...prev, `🤖 ${eventData.message || eventData.purpose}`]);
          } 
          // *** THE HITL INTERCEPTOR ***
          else if (eventData.type === 'HITL_REQUIRED') {
            setLogs((prev) => [...prev, `⚠️ ${eventData.message}`]);
            setRequiresInput(true); // This triggers the UI to show the OTP box
          }
          else if (eventData.type === 'ERROR') {
            setLogs((prev) => [...prev, `⚠️ ${eventData.message}`]);
          }
          else if (eventData.type === 'COMPLETE') {
            setResult(eventData.resultJson || eventData.result);
            setLogs((prev) => [...prev, '✅ Task Completed Successfully!']);
            setIsLoading(false);
            ws.close();
          }
          else if (eventData.type === 'FATAL_ERROR') {
            setLogs((prev) => [...prev, `❌ Fatal Error: ${eventData.message}`]);
            setIsLoading(false);
            ws.close();
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      ws.onerror = () => {
        setLogs((prev) => [...prev, '❌ Lost connection to the live stream.']);
        setIsLoading(false);
      };

    } catch (error) {
      setLogs((prev) => [...prev, '❌ Error connecting to backend.']);
      setIsLoading(false);
    }
  };

  // *** THE HITL SUBMITTER ***
  const submitIntervention = async () => {
    if (!activeJobId || !userInput) return;
    
    setRequiresInput(false); // Hide the input box immediately
    setLogs((prev) => [...prev, `👤 Human Input: "${userInput}" sending to cloud...`]);

    try {
      const response = await fetch(`http://localhost:8000/api/agent/${activeJobId}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_input: userInput }),
      });

      if (!response.ok) throw new Error('Failed to send input');
      setUserInput(''); // Clear the input field
      
    } catch (error) {
      setLogs((prev) => [...prev, '❌ Failed to inject data into the session.']);
      setRequiresInput(true); // Show it again if it failed
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>AutoProcure Command Center</h1>
      
      <form onSubmit={runAgent} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div>
          <label><strong>Target Platform:</strong></label><br/>
          <input 
            type="text" 
            value={url} 
            onChange={(e) => setUrl(e.target.value)} 
            disabled={isLoading}
            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>
        <div>
          <label><strong>Procurement AI Prompt:</strong></label><br/>
          <textarea 
            rows={4} 
            value={goal} 
            onChange={(e) => setGoal(e.target.value)} 
            disabled={isLoading}
            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>
        <button 
          type="submit" 
          disabled={isLoading}
          style={{ 
            padding: '12px', 
            backgroundColor: isLoading ? '#6c757d' : '#0056b3', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontWeight: 'bold'
          }}
        >
          {isLoading ? 'Agent Deployed...' : 'Dispatch Cloud Worker'}
        </button>
      </form>

      {/* *** THE CONDITIONAL HITL COMPONENT *** */}
      {requiresInput && (
        <div style={{ 
          marginTop: '20px', padding: '20px', background: '#fff3cd', border: '2px solid #ffe69c', borderRadius: '5px' 
        }}>
          <h3 style={{ color: '#856404', marginTop: 0 }}>⚠️ Human Intervention Required</h3>
          <p style={{ color: '#856404' }}>The agent has hit a roadblock (likely an Amazon OTP or CAPTCHA). Please provide the requested code or text to resume automation.</p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input 
              type="text" 
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="Enter 6-digit OTP..."
              style={{ flex: 1, padding: '10px', fontSize: '16px' }}
            />
            <button 
              onClick={submitIntervention}
              style={{ padding: '10px 20px', backgroundColor: '#28a745', color: 'white', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}
            >
              Inject Data
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: '30px' }}>
        <h3>Live Cloud Terminal:</h3>
        <div style={{ background: '#1e1e1e', color: '#00ff00', padding: '15px', borderRadius: '5px', height: '250px', overflowY: 'auto', fontFamily: 'monospace' }}>
          {logs.map((log, index) => (
            <div key={index} style={{ margin: '5px 0' }}>{log}</div>
          ))}
          {isLoading && !requiresInput && <div style={{ color: '#888', fontStyle: 'italic', marginTop: '10px' }}>_ awaiting stream data...</div>}
        </div>
      </div>

      {result && (
        <div style={{ marginTop: '30px' }}>
          <h3>Final Extracted JSON Data:</h3>
          <pre style={{ background: '#f8f9fa', border: '1px solid #dee2e6', padding: '15px', borderRadius: '5px', overflowX: 'auto' }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default AgentUI;